// Roger's sounds play whenever they are on, however the system left the audio (stopped until a
// click, interrupted by sleep or new headphones), wait for the Sounds setting instead of guessing
// it, and are never played late.
import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import * as sound from "../companion/sound";

let contexts: FakeContext[] = [];
let started = 0;
class FakeContext {
  state: "running" | "suspended" | "interrupted" | "closed";
  currentTime = 0;
  resumes = 0;
  destination = {};
  constructor() {
    this.state = FakeContext.next;
    contexts.push(this);
  }
  static next: FakeContext["state"] = "suspended";
  static resumeWorks = true;
  resume() {
    this.resumes++;
    if (FakeContext.resumeWorks) this.state = "running";
    return Promise.resolve();
  }
  private node() {
    const param = { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} };
    const n = { gain: param, frequency: param, type: "", connect: () => n, start: () => started++, stop() {} };
    return n;
  }
  createGain() {
    return this.node();
  }
  createOscillator() {
    return this.node();
  }
}
(globalThis as unknown as { AudioContext: unknown }).AudioContext = FakeContext;

const load = async () => (sound.forgetSounds(), sound);
const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  contexts = [];
  started = 0;
  FakeContext.next = "suspended";
  FakeContext.resumeWorks = true;
});

test("a sound asked for before the Sounds setting is known waits for it", async () => {
  const s = await load();
  s.sounds.done();
  await settle();
  assert.equal(started, 0, "nothing plays while the setting is unknown");
  s.setSoundsOn(true);
  await settle();
  assert.equal(started, 4, "the held sound plays once sounds are on");
});

test("off is silent; a held sound is dropped when the setting says off", async () => {
  const s = await load();
  s.sounds.done();
  s.setSoundsOn(false);
  s.sounds.needs();
  await settle();
  assert.equal(started, 0);
});

test("stopped or interrupted audio is started again before the sound, not after it", async () => {
  const s = await load();
  s.setSoundsOn(true);
  s.sounds.tick();
  await settle();
  assert.equal(contexts[0].resumes, 1);
  assert.equal(started, 1, "played once the clock runs");
  // The Mac slept: WebKit calls it interrupted, not suspended.
  contexts[0].state = "interrupted";
  s.sounds.tick();
  await settle();
  assert.equal(contexts[0].resumes, 2);
  assert.equal(started, 2);
});

test("audio the system will not start yet plays nothing, and a closed one is made again", async () => {
  const s = await load();
  s.setSoundsOn(true);
  FakeContext.resumeWorks = false;
  s.sounds.tick();
  await settle();
  assert.equal(started, 0, "no sound on a stopped clock");
  contexts[0].state = "closed";
  FakeContext.next = "running";
  s.sounds.tick();
  await settle();
  assert.equal(contexts.length, 2);
  assert.equal(started, 1);
});

test("the phone page, with no switch, has sounds on", async () => {
  const s = await load();
  FakeContext.next = "running";
  s.soundsHaveNoSwitch();
  s.sounds.open();
  await settle();
  assert.equal(started, 1);
});
