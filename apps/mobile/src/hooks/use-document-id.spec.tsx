/// <reference types="jest" />
import { act, fireEvent, render, screen } from "@testing-library/react-native";
import { Pressable, Text } from "react-native";
import { useState } from "react";
import { IdempotencyRefusal } from "@mezan/contracts";
import { ApiError, ApiFailure } from "@/api/errors";
import { useDocumentId } from "./use-document-id";

type Answer = "fails" | "succeeds" | "already-saved";

function SaveButton({ answers, sent }: { answers: Answer[]; sent: string[] }) {
  const [notice, setNotice] = useState("");
  const id = useDocumentId((savedId) => setNotice(`saved:${savedId}`));
  const press = (): void => {
    sent.push(id.current());
    const answer = answers.shift();
    try {
      if (answer === "fails") throw new ApiError(ApiFailure.Network, null, null, null);
      if (answer === "already-saved") throw new ApiError(ApiFailure.Refused, 409, "سبق تسجيل مستند", null, IdempotencyRefusal.KeyReused);
      id.renew();
      setNotice("created");
    } catch (err) {
      if (!id.recover(err)) setNotice("failed");
    }
  };
  return (
    <>
      <Pressable accessibilityRole="button" onPress={press}>
        <Text>حفظ</Text>
      </Pressable>
      <Text testID="notice">{notice}</Text>
    </>
  );
}

const press = () => act(() => fireEvent.press(screen.getByRole("button")));

describe("the id a mobile form sends with a create", () => {
  it("is the same on the press after a press that failed", async () => {
    const sent: string[] = [];
    await render(<SaveButton answers={["fails", "fails", "succeeds"]} sent={sent} />);

    await press();
    await press();
    await press();

    expect(screen.getByTestId("notice").props.children).toBe("created");
    expect(sent[1]).toBe(sent[0]);
    expect(sent[2]).toBe(sent[0]);
  });

  it("is a new one after a success, and after the server says the id already holds a document", async () => {
    const sent: string[] = [];
    await render(<SaveButton answers={["succeeds", "already-saved", "succeeds"]} sent={sent} />);

    await press();
    await press();
    expect(screen.getByTestId("notice").props.children).toBe(`saved:${sent[1]}`);
    await press();

    expect(new Set(sent).size).toBe(3);
  });
});
