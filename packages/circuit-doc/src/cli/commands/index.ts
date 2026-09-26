/**
 * The command registry, in help order. Each entry is its module's own
 * `command` export; replacing a stub means replacing its module file, never
 * editing this list.
 */

import type { CommandModule } from "../command.ts";
import { command as check } from "./check.ts";
import { command as checkBrowser } from "./check-browser.ts";
import { command as checkBuilt } from "./check-built.ts";
import { command as doctor } from "./doctor.ts";
import { command as footprints } from "./footprints.ts";
import { command as generate } from "./generate.ts";
import { command as models } from "./models.ts";
import { command as newComponent } from "./new-component.ts";
import { command as scan } from "./scan.ts";
import { command as validate } from "./validate.ts";

export const COMMANDS: readonly CommandModule[] = [
  generate,
  check,
  validate,
  models,
  footprints,
  scan,
  checkBuilt,
  checkBrowser,
  doctor,
  newComponent,
];
