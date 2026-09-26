#!/usr/bin/env node

import { main } from "../dist/cli.js";

const exitCode = await main(process.argv.slice(2));
if (exitCode !== 0) process.exitCode = exitCode;
