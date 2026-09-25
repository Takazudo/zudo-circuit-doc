#!/usr/bin/env node

import { main } from "../dist/cli.js";

const exitCode = await main();
if (exitCode !== 0) process.exitCode = exitCode;
