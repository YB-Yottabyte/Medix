import assert from "node:assert/strict";
import test from "node:test";
import { isSmallTalk } from "../../lib/ai/small-talk";

test("greetings, thanks, and capability questions are small talk", () => {
  for (const message of [
    "Hi",
    "hello!",
    "hey there",
    "Good morning",
    "Thanks",
    "thank you so much",
    "thanks, that was helpful",
    "ok",
    "got it",
    "bye",
    "What can you do?",
    "what are you",
    "So what can you help with?",
    "what is medix",
    "help",
  ]) {
    assert.equal(isSmallTalk(message), true, message);
  }
});

test("medical questions are never small talk", () => {
  for (const message of [
    "How do I perform CPR on an adult?",
    "Hi, how do I stop heavy bleeding?",
    "thanks — now what should I do about the AED pads?",
    "Where should I place the pads?",
    "What should I do next?",
    "Can I use a shirt instead?",
    "How long should I keep compressions going?",
    "what can you do about a burn on the hand",
  ]) {
    assert.equal(isSmallTalk(message), false, message);
  }
});

test("empty and overlong messages are not small talk", () => {
  assert.equal(isSmallTalk(""), false);
  assert.equal(isSmallTalk("   "), false);
  assert.equal(isSmallTalk(`thanks ${"and more words ".repeat(6)}`), false);
});
