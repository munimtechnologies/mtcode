import { describe, expect, it } from "vite-plus/test";

import wasmDataUrl from "./vendor/ghostty-vt.wasm?inline";
import writePtyWasmDataUrl from "./vendor/ghostty-write-pty.wasm?inline";
import pinnedVersion from "../../../../../native/libghostty-vt/VERSION?raw";
import { ghosttyKeyForCode } from "./keyCodes";

type WasmFunction = (...args: number[]) => number;

function decodeWasmDataUrl(dataUrl: string): Uint8Array {
  const encoded = dataUrl.split(",", 2)[1];
  if (!encoded) throw new Error("The vendored Ghostty WASM data URL is invalid");
  return Uint8Array.from(atob(encoded), (character) => character.charCodeAt(0));
}

describe("vendored libghostty-vt WebAssembly", () => {
  it("stays pinned to the canonical revision and size budget", async () => {
    const wasm = decodeWasmDataUrl(wasmDataUrl);
    expect(wasm.byteLength).toBeLessThan(750_000);

    const result = await WebAssembly.instantiate(wasm.buffer as ArrayBuffer, {
      env: { log: () => {} },
    });
    const instance = result instanceof WebAssembly.Instance ? result : result.instance;
    const memory = instance.exports.memory as WebAssembly.Memory;
    const call = (name: string, ...args: number[]) =>
      (instance.exports[name] as WasmFunction)(...args);
    const out = call("ghostty_wasm_alloc_u8_array", 8);
    expect(call("ghostty_build_info", 10, out)).toBe(0);
    const view = new DataView(memory.buffer, out, 8);
    const embeddedRevision = new TextDecoder().decode(
      new Uint8Array(memory.buffer, view.getUint32(0, true), view.getUint32(4, true)),
    );
    call("ghostty_wasm_free_u8_array", out, 8);
    expect(embeddedRevision).toBe(pinnedVersion.trim());
  });

  it("routes terminal-generated replies through the shared callback table", async () => {
    const mainResult = await WebAssembly.instantiate(
      decodeWasmDataUrl(wasmDataUrl).buffer as ArrayBuffer,
      { env: { log: () => {} } },
    );
    const main = mainResult instanceof WebAssembly.Instance ? mainResult : mainResult.instance;
    const memory = main.exports.memory as WebAssembly.Memory;
    let reply = "";
    const trampolineResult = await WebAssembly.instantiate(
      decodeWasmDataUrl(writePtyWasmDataUrl).buffer as ArrayBuffer,
      {
        env: {
          t3_write_pty: (_terminal: number, _userdata: number, pointer: number, length: number) => {
            reply += new TextDecoder().decode(new Uint8Array(memory.buffer, pointer, length));
          },
        },
      },
    );
    const trampoline =
      trampolineResult instanceof WebAssembly.Instance
        ? trampolineResult
        : trampolineResult.instance;
    const table = main.exports.__indirect_function_table as WebAssembly.Table;
    const callbackIndex = table.length;
    table.grow(1, trampoline.exports.ghostty_write_pty as CallableFunction);
    const call = (name: string, ...args: number[]) => (main.exports[name] as WasmFunction)(...args);
    const options = call("ghostty_wasm_alloc_u8_array", 8);
    const optionsView = new DataView(memory.buffer, options, 8);
    optionsView.setUint16(0, 80, true);
    optionsView.setUint16(2, 24, true);
    const terminalSlot = call("ghostty_wasm_alloc_opaque");
    expect(call("ghostty_terminal_new", 0, terminalSlot, options)).toBe(0);
    const terminal = new DataView(memory.buffer).getUint32(terminalSlot, true);
    call("ghostty_terminal_set", terminal, 0, 1);
    call("ghostty_terminal_set", terminal, 1, callbackIndex);
    const query = new TextEncoder().encode("\u001b[5n");
    const queryPointer = call("ghostty_wasm_alloc_u8_array", query.length);
    new Uint8Array(memory.buffer, queryPointer, query.length).set(query);
    call("ghostty_terminal_vt_write", terminal, queryPointer, query.length);

    expect(reply).toBe("\u001b[0n");
    reply = "";
    call("ghostty_terminal_set", terminal, 1, 0);
    call("ghostty_terminal_set", terminal, 0, 0);
    call("ghostty_terminal_vt_write", terminal, queryPointer, query.length);
    expect(reply).toBe("");
    call("ghostty_terminal_set", terminal, 0, 1);
    call("ghostty_terminal_set", terminal, 1, callbackIndex);
    call("ghostty_terminal_vt_write", terminal, queryPointer, query.length);
    expect(reply).toBe("\u001b[0n");
    call("ghostty_wasm_free_u8_array", queryPointer, query.length);
    call("ghostty_terminal_free", terminal);
    call("ghostty_wasm_free_opaque", terminalSlot);
    call("ghostty_wasm_free_u8_array", options, 8);
  });

  it("encodes modified printable keys in Kitty keyboard mode", async () => {
    const result = await WebAssembly.instantiate(
      decodeWasmDataUrl(wasmDataUrl).buffer as ArrayBuffer,
      { env: { log: () => {} } },
    );
    const instance = result instanceof WebAssembly.Instance ? result : result.instance;
    const memory = instance.exports.memory as WebAssembly.Memory;
    const call = (name: string, ...args: number[]) =>
      (instance.exports[name] as WasmFunction)(...args);
    const alloc = (size: number) => call("ghostty_wasm_alloc_u8_array", size);
    const free = (pointer: number, size: number) =>
      call("ghostty_wasm_free_u8_array", pointer, size);

    const terminalOptions = alloc(8);
    const terminalOptionsView = new DataView(memory.buffer, terminalOptions, 8);
    terminalOptionsView.setUint16(0, 80, true);
    terminalOptionsView.setUint16(2, 24, true);
    const terminalSlot = call("ghostty_wasm_alloc_opaque");
    expect(call("ghostty_terminal_new", 0, terminalSlot, terminalOptions)).toBe(0);
    const terminal = new DataView(memory.buffer).getUint32(terminalSlot, true);
    const encoderSlot = call("ghostty_wasm_alloc_opaque");
    const eventSlot = call("ghostty_wasm_alloc_opaque");
    expect(call("ghostty_key_encoder_new", 0, encoderSlot)).toBe(0);
    expect(call("ghostty_key_event_new", 0, eventSlot)).toBe(0);
    const view = new DataView(memory.buffer);
    const keyEncoder = view.getUint32(encoderSlot, true);
    const keyEvent = view.getUint32(eventSlot, true);
    call("ghostty_key_encoder_setopt_from_terminal", keyEncoder, terminal);
    call("ghostty_key_event_set_action", keyEvent, 1);
    call("ghostty_key_event_set_key", keyEvent, ghosttyKeyForCode("KeyA"));
    call("ghostty_key_event_set_mods", keyEvent, 1 << 1);
    call("ghostty_key_event_set_consumed_mods", keyEvent, 0);
    call("ghostty_key_event_set_composing", keyEvent, 0);
    call("ghostty_key_event_set_unshifted_codepoint", keyEvent, "a".codePointAt(0)!);
    call("ghostty_key_event_set_utf8", keyEvent, 0, 0);

    const written = call("ghostty_wasm_alloc_usize");
    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const legacyControlSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const legacyControlOutput = alloc(legacyControlSize);
    expect(
      call(
        "ghostty_key_encoder_encode",
        keyEncoder,
        keyEvent,
        legacyControlOutput,
        legacyControlSize,
        written,
      ),
    ).toBe(0);
    const legacyControlLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(
      new TextDecoder().decode(
        new Uint8Array(memory.buffer, legacyControlOutput, legacyControlLength),
      ),
    ).toBe("\u0001");

    const kittyMode = new TextEncoder().encode("\u001b[>1u");
    const kittyModePointer = alloc(kittyMode.length);
    new Uint8Array(memory.buffer, kittyModePointer, kittyMode.length).set(kittyMode);
    call("ghostty_terminal_vt_write", terminal, kittyModePointer, kittyMode.length);
    call("ghostty_key_encoder_setopt_from_terminal", keyEncoder, terminal);

    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const kittyControlSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const kittyControlOutput = alloc(kittyControlSize);
    expect(
      call(
        "ghostty_key_encoder_encode",
        keyEncoder,
        keyEvent,
        kittyControlOutput,
        kittyControlSize,
        written,
      ),
    ).toBe(0);
    const kittyControlLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(
      new TextDecoder().decode(
        new Uint8Array(memory.buffer, kittyControlOutput, kittyControlLength),
      ),
    ).toBe("\u001b[97;5u");

    // Without the Kitty report-event-types flag a release encodes nothing.
    call("ghostty_key_event_set_action", keyEvent, 0);
    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(0);
    expect(new DataView(memory.buffer, written, 4).getUint32(0, true)).toBe(0);

    const reportEvents = new TextEncoder().encode("\u001b[>3u");
    const reportEventsPointer = alloc(reportEvents.length);
    new Uint8Array(memory.buffer, reportEventsPointer, reportEvents.length).set(reportEvents);
    call("ghostty_terminal_vt_write", terminal, reportEventsPointer, reportEvents.length);
    call("ghostty_key_encoder_setopt_from_terminal", keyEncoder, terminal);
    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const controlReleaseSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const controlReleaseOutput = alloc(controlReleaseSize);
    expect(
      call(
        "ghostty_key_encoder_encode",
        keyEncoder,
        keyEvent,
        controlReleaseOutput,
        controlReleaseSize,
        written,
      ),
    ).toBe(0);
    const controlReleaseLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(
      new TextDecoder().decode(
        new Uint8Array(memory.buffer, controlReleaseOutput, controlReleaseLength),
      ),
    ).toBe("\u001b[97;5:3u");

    call("ghostty_key_event_set_action", keyEvent, 1);
    call("ghostty_key_event_set_key", keyEvent, ghosttyKeyForCode("KeyC"));
    call("ghostty_key_event_set_mods", keyEvent, 1 << 1);
    call("ghostty_key_event_set_consumed_mods", keyEvent, 0);
    call("ghostty_key_event_set_composing", keyEvent, 0);
    call("ghostty_key_event_set_unshifted_codepoint", keyEvent, "c".codePointAt(0)!);
    const text = new TextEncoder().encode("c");
    const textPointer = alloc(text.length);
    new Uint8Array(memory.buffer, textPointer, text.length).set(text);
    call("ghostty_key_event_set_utf8", keyEvent, textPointer, text.length);

    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const outputSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const output = alloc(outputSize);
    expect(
      call("ghostty_key_encoder_encode", keyEncoder, keyEvent, output, outputSize, written),
    ).toBe(0);
    const outputLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(new TextDecoder().decode(new Uint8Array(memory.buffer, output, outputLength))).toBe(
      "\u001b[99;5u",
    );

    const remappedText = new TextEncoder().encode("j");
    const remappedTextPointer = alloc(remappedText.length);
    new Uint8Array(memory.buffer, remappedTextPointer, remappedText.length).set(remappedText);
    call("ghostty_key_event_set_unshifted_codepoint", keyEvent, "j".codePointAt(0)!);
    call("ghostty_key_event_set_utf8", keyEvent, remappedTextPointer, remappedText.length);
    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const remappedOutputSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const remappedOutput = alloc(remappedOutputSize);
    expect(
      call(
        "ghostty_key_encoder_encode",
        keyEncoder,
        keyEvent,
        remappedOutput,
        remappedOutputSize,
        written,
      ),
    ).toBe(0);
    const remappedOutputLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(
      new TextDecoder().decode(new Uint8Array(memory.buffer, remappedOutput, remappedOutputLength)),
    ).toBe("\u001b[106;5u");

    // With report-event-types enabled the release includes its event type.
    call("ghostty_key_event_set_action", keyEvent, 0);
    expect(call("ghostty_key_encoder_encode", keyEncoder, keyEvent, 0, 0, written)).toBe(-3);
    const releaseSize = new DataView(memory.buffer, written, 4).getUint32(0, true);
    const releaseOutput = alloc(releaseSize);
    expect(
      call("ghostty_key_encoder_encode", keyEncoder, keyEvent, releaseOutput, releaseSize, written),
    ).toBe(0);
    const releaseLength = new DataView(memory.buffer, written, 4).getUint32(0, true);
    expect(
      new TextDecoder().decode(new Uint8Array(memory.buffer, releaseOutput, releaseLength)),
    ).toBe("\u001b[106;5:3u");
    free(releaseOutput, releaseSize);
    free(reportEventsPointer, reportEvents.length);

    free(remappedOutput, remappedOutputSize);
    free(remappedTextPointer, remappedText.length);
    free(output, outputSize);
    free(controlReleaseOutput, controlReleaseSize);
    free(kittyControlOutput, kittyControlSize);
    free(legacyControlOutput, legacyControlSize);
    call("ghostty_wasm_free_usize", written);
    free(textPointer, text.length);
    call("ghostty_key_event_free", keyEvent);
    call("ghostty_key_encoder_free", keyEncoder);
    call("ghostty_wasm_free_opaque", eventSlot);
    call("ghostty_wasm_free_opaque", encoderSlot);
    free(kittyModePointer, kittyMode.length);
    call("ghostty_terminal_free", terminal);
    call("ghostty_wasm_free_opaque", terminalSlot);
    free(terminalOptions, 8);
  });
});
