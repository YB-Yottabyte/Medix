import assert from "node:assert/strict";
import test from "node:test";
import type { LanguageModel } from "ai";
import {
  clarificationReply,
  GENERAL_CHAT_PROMPT,
  needsMedicalEvidence,
  OUT_OF_SCOPE_REPLY,
  planMedixTurn,
} from "../../lib/ai/chat-routing";

const model = {} as LanguageModel;

test("greetings skip the classifier and retrieval", async () => {
  assert.equal(
    await needsMedicalEvidence({
      classify: async () => {
        throw new Error("must not classify greeting");
      },
      model,
      question: "Hey, how are you doing?",
      recentConversation: "",
    }),
    false
  );
});
test("general intent bypasses retrieval even with an image or prior procedure", async () => {
  for (const question of [
    "Explain recursion",
    "Write a birthday message",
    "What color is this bag?",
  ]) {
    assert.equal(
      await needsMedicalEvidence({
        classify: async (prompt) => {
          assert.ok(prompt.includes(question));
          return "GENERAL";
        },
        hasImage: true,
        model,
        question,
        recentConversation: "Discussed CPR",
      }),
      false
    );
  }
});
test("procedure and follow-up intent retains evidence routing", async () => {
  for (const question of ["How do I bandage a hand?", "Where do I place it?"]) {
    assert.equal(
      await needsMedicalEvidence({
        classify: async () => "EVIDENCE",
        model,
        question,
        recentConversation: "Discussed bandaging",
      }),
      true
    );
  }
});
test("invalid or failed classifier cannot enable ungrounded medical answers", async () => {
  for (const classify of [
    async () => "maybe",
    async () => {
      throw new Error("offline");
    },
  ]) {
    assert.equal(
      await needsMedicalEvidence({
        classify,
        model,
        question: "What do I do next?",
        recentConversation: "",
      }),
      null
    );
  }
});

test("ambiguous bandaging asks for context without retrieval or a model call", async () => {
  for (const question of [
    "can you help me with how to band the bandage?",
    "How do I apply a bandage?",
  ]) {
    assert.equal(
      await planMedixTurn({
        classify: async () => {
          throw new Error("must not call model");
        },
        model,
        question,
        recentConversation: "",
      }),
      "clarify"
    );
    assert.match(clarificationReply(question), /body part.*type of bandage/);
  }
});
test("existing context and urgent or specific questions do not get the generic bandage clarification", async () => {
  for (const [question, recentConversation] of [
    ["How do I apply a bandage?", "I hurt my hand and have an elastic bandage"],
    ["How do I bandage a hand?", ""],
    ["How do I bandage severe bleeding?", ""],
  ]) {
    assert.equal(
      await planMedixTurn({
        classify: async () => "EVIDENCE",
        model,
        question,
        recentConversation,
      }),
      "evidence"
    );
  }
});
test("unrelated requests are routed to a short Medix-only redirect", async () => {
  for (const question of [
    "Write a Python app",
    "Help with my essay",
    "What color is this car?",
  ]) {
    assert.equal(
      await planMedixTurn({
        classify: async () => "OUT_OF_SCOPE",
        model,
        question,
        recentConversation: "",
      }),
      "out_of_scope"
    );
  }
  assert.ok(OUT_OF_SCOPE_REPLY.split(/\s+/).length < 30);
  assert.match(GENERAL_CHAT_PROMPT, /exclusively within Medix/);
});
