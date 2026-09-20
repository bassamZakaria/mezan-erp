import type { ScenarioFragment } from "./fragments.js";

const USD_STATEMENT = "BSTMT-DEMO-USD-1";
const USD_TREASURY = "TR-DEMO-BANK-USD";
const USD_ACCOUNT_NUMBER = "EG380003000100000000263180777";

const OFX = (accountNumber: string, currency: string) =>
  [
    "<OFX><BANKMSGSRSV1><STMTTRNRS><STMTRS>",
    `<CURDEF>${currency}</CURDEF>`,
    `<BANKACCTFROM><ACCTID>${accountNumber}</ACCTID></BANKACCTFROM>`,
    "<BANKTRANLIST><DTSTART>20260901</DTSTART><DTEND>20260930</DTEND>",
    "<STMTTRN><TRNTYPE>DEBIT</TRNTYPE><DTPOSTED>20260910</DTPOSTED><TRNAMT>-11.00</TRNAMT><FITID>SCN0001</FITID><NAME>SCN FEE</NAME></STMTTRN>",
    "</BANKTRANLIST><LEDGERBAL><BALAMT>-11.00</BALAMT></LEDGERBAL>",
    "</STMTRS></STMTTRNRS></BANKMSGSRSV1></OFX>",
  ].join("\n");

/**
 * Smart bank reconciliation (ENH-E1-03) — the four review findings, exercised
 * through the routes the screen calls.
 */
export const scenario: ScenarioFragment = {
  smokePaths: ["/bank-statements", "/bank-statements/rules"],

  async run(ctx) {
    const { scenario: it, req, rows, n, check, checkEq } = ctx;

    await it("bank rec · a foreign-currency account reconciles in its own currency", async () => {
      const statement = (await req("GET", `/bank-statements/${USD_STATEMENT}`)).body;
      check("the seeded USD statement exists", statement?.id === USD_STATEMENT, JSON.stringify(statement).slice(0, 160));
      checkEq("and states its own currency", statement?.currency === "USD" ? 1 : 0, 1);
      checkEq("its branch is stamped from the account, not from the client", statement?.branchId === "BR-MAIN" ? 1 : 0, 1);

      const matched = (statement?.lines ?? []).filter((l: any) => l.status === "matched");
      checkEq("the 1,200.00 USD receipt is matched", matched.length, 1);
      checkEq("to the entry the books hold, at the dollar figure", n(matched[0]?.amount), 1200);
      check("and the match names a real journal entry", typeof matched[0]?.matchedEntryNo === "string", JSON.stringify(matched[0]));

      const position = statement?.position;
      checkEq("the book balance is stated in dollars too", n(position?.bookBalance), 1200);
      checkEq("and the open difference is the unmatched dollar fee", n(position?.difference), -25);
    });

    await it("bank rec · re-importing the same file is recognised, not duplicated", async () => {
      const before = rows((await req("GET", "/bank-statements")).body).length;
      const first = await req("POST", "/bank-statements/import-file", {
        id: "SCN-BS-USD-2",
        treasuryAccountId: USD_TREASURY,
        format: "ofx",
        content: OFX(USD_ACCOUNT_NUMBER, "USD"),
        openingBalance: "0.00",
      });
      checkEq("the first import is accepted", first.status, 201);

      const again = await req("POST", "/bank-statements/import-file", {
        id: "SCN-BS-USD-3",
        treasuryAccountId: USD_TREASURY,
        format: "ofx",
        content: OFX(USD_ACCOUNT_NUMBER, "USD"),
        openingBalance: "0.00",
      });
      checkEq("the second is refused as a duplicate", again.status, 409);
      check("naming the statement that already holds those rows", again.body?.existingStatementId === "SCN-BS-USD-2", JSON.stringify(again.body));
      check("in Arabic and English", typeof again.body?.message === "string" && typeof again.body?.messageEn === "string");
      checkEq("and exactly one statement was added", rows((await req("GET", "/bank-statements")).body).length - before, 1);
    });

    await it("bank rec · the file's own account and currency are checked against the account", async () => {
      const wrongCurrency = await req("POST", "/bank-statements/import-file", {
        id: "SCN-BS-CUR",
        treasuryAccountId: USD_TREASURY,
        format: "ofx",
        content: OFX(USD_ACCOUNT_NUMBER, "EUR"),
        openingBalance: "0.00",
      });
      checkEq("a euro file into a dollar account is refused", wrongCurrency.status, 422);
      check("with the currency it names", wrongCurrency.body?.error === "STATEMENT_CURRENCY_MISMATCH", JSON.stringify(wrongCurrency.body));

      const wrongAccount = await req("POST", "/bank-statements/import-file", {
        id: "SCN-BS-ACC",
        treasuryAccountId: USD_TREASURY,
        format: "ofx",
        content: OFX("EG000000000000000000000000000", "USD"),
        openingBalance: "0.00",
      });
      checkEq("a file for another bank account is refused", wrongAccount.status, 422);
      check("with the account number it names", wrongAccount.body?.error === "STATEMENT_ACCOUNT_MISMATCH", JSON.stringify(wrongAccount.body));
    });

    await it("bank rec · a statement outside the caller's branches is neither listed nor openable", async () => {
      const mine = rows((await req("GET", "/bank-statements", undefined, { "x-branch-grant": "BR-MAIN" })).body);
      check("a BR-MAIN caller sees the BR-MAIN statements", mine.some((s: any) => s.id === USD_STATEMENT), String(mine.length));

      const elsewhere = await req("GET", "/bank-statements", undefined, { "x-branch-grant": "BR-ALEX" });
      checkEq("a caller granted another branch sees none of them", rows(elsewhere.body).filter((s: any) => s.branchId === "BR-MAIN").length, 0);

      const opened = await req("GET", `/bank-statements/${USD_STATEMENT}`, undefined, { "x-branch-grant": "BR-ALEX" });
      checkEq("and cannot open one by its id either", opened.status, 403);
      check("refused as a branch-scope matter, not a missing row", opened.body?.error === "STATEMENT_OUT_OF_BRANCH_SCOPE", JSON.stringify(opened.body));

      const imported = await req(
        "POST",
        "/bank-statements/import-file",
        { id: "SCN-BS-SCOPE", treasuryAccountId: USD_TREASURY, format: "ofx", content: OFX(USD_ACCOUNT_NUMBER, "USD"), openingBalance: "0.00" },
        { "x-branch-grant": "BR-ALEX" },
      );
      checkEq("nor import into that branch's account", imported.status, 403);
    });
  },
};
