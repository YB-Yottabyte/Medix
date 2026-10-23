import assert from "node:assert/strict";
import test from "node:test";
import { isSmallTalk, smallTalkReply } from "../../lib/ai/small-talk";

test("greetings, thanks, and capability questions are small talk", () => {
  for (const message of [
    "Hi",
    "hello!",
    "hey there",
    "Hey, How are you doing?",
    "How are you?",
    "Hello! How are you today?",
    "How’s it going?",
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
    "Hey, how are you doing? How do I bandage a hand?",
    "How are you treating burns?",
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

test("assistant identity questions bypass video retrieval, including common punctuation typos", () => {
  for (const message of [
    "What's your name?",
    "What’s your name?",
    "Whats' your name?",
    "whats your name",
    "What is your name?",
    "Introduce yourself",
    "What should I call you?",
  ]) {
    assert.equal(isSmallTalk(message), true, message);
  }
  for (const message of [
    "What's the speaker's name?",
    "What is your name and how do I do CPR?",
    "What's the name of this bandage?",
  ]) {
    assert.equal(isSmallTalk(message), false, message);
  }
});

test("short replies are available without a model and never swallow procedure questions", () => {
  assert.match(smallTalkReply("What’s your name?") ?? "", /Medix/);
  assert.match(smallTalkReply("Hey") ?? "", /How can I help/);
  assert.equal(smallTalkReply("Hey, how do I treat a burn?"), null);
});
