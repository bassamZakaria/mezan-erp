import { describe, it, expect, beforeEach } from "vitest";
import { Money } from "../money/index.js";
import { NextNumberService } from "../numbering/index.js";
import { postJournalEntry, type JournalPostingDeps } from "../gl/post.js";
import { planYearEndClose } from "../gl/year-end-close.js";
import { InMemoryLedgerRepository, InMemorySequenceStore } from "../gl/test-helpers/in-memory-ledger-repository.js";
import { InMemoryFiscalPeriodRepository } from "../fiscal-periods/test-helpers/in-memory-fiscal-period-repository.js";
import { runReport } from "../reports/engine.js";
import { createTrialBalanceReport } from "../reports/trial-balance.js";
import type { Account } from "./account.js";
import { InMemoryAccountRepository } from "./test-helpers/in-memory-account-repository.js";
import { updateAccount } from "./update-account.js";

/**
 * The chart of accounts against the ledger it already carries.
 *
 * `updateAccount` re-checks the HIERARCHY (parent exists, no cycle, a header
 * with children stays a header) and nothing about the postings the account is
 * already holding. Every check below runs the REAL posting engine into a real
 * ledger, then runs the REAL trial balance over the same two collections the
 * report route feeds it, so an edit that strands a balance shows up as the
 * trial balance failing to foot.
 */

interface Harness {
  accounts: InMemoryAccountRepository;
  ledger: InMemoryLedgerRepository;
  deps: JournalPostingDeps;
}
