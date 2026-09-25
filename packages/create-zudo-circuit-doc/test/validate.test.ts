import assert from "node:assert/strict";
import test from "node:test";
import { CliUsageError } from "../src/errors.ts";
import {
  titleCaseFromName,
  validateLibrary,
  validateName,
  validateTitle,
} from "../src/validate.ts";

test("validateName accepts valid npm names", () => {
  for (const name of ["a", "my-project", "my.project_1", "@scope/pkg", "@scope/pkg-2"]) {
    assert.doesNotThrow(() => validateName(name));
  }
});

test("validateName rejects invalid names", () => {
  for (const name of [
    "",
    "Uppercase",
    "-leading-dash",
    "has space",
    "node_modules",
    "@scope-only",
    "a".repeat(215),
  ]) {
    assert.throws(() => validateName(name), CliUsageError, name);
  }
});

test("validateTitle accepts printable titles within 1-80 chars", () => {
  assert.doesNotThrow(() => validateTitle("My Circuit Project"));
  assert.doesNotThrow(() => validateTitle("a".repeat(80)));
});

test("validateTitle rejects empty, too-long, control chars, and forbidden symbols", () => {
  assert.throws(() => validateTitle(""), CliUsageError);
  assert.throws(() => validateTitle("a".repeat(81)), CliUsageError);
  assert.throws(() => validateTitle("bad\ntitle"), CliUsageError);
  for (const ch of ["\"", "'", "`", "\\", "$", "<", ">", "{", "}"]) {
    assert.throws(() => validateTitle(`title${ch}`), CliUsageError, ch);
  }
});

test("validateLibrary accepts the KiCad library grammar", () => {
  for (const lib of ["a", "My_Lib-1", "A".repeat(64)]) {
    assert.doesNotThrow(() => validateLibrary(lib));
  }
});

test("validateLibrary rejects leading symbols, bad chars, and over-length", () => {
  for (const lib of ["-lib", "_lib", "lib name", "lib!", "a".repeat(65)]) {
    assert.throws(() => validateLibrary(lib), CliUsageError, lib);
  }
});

test("titleCaseFromName title-cases hyphen/underscore-separated names", () => {
  assert.equal(titleCaseFromName("my-project"), "My Project");
  assert.equal(titleCaseFromName("my_cool_thing"), "My Cool Thing");
  assert.equal(titleCaseFromName("single"), "Single");
});
