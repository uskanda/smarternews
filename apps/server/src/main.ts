#!/usr/bin/env node
import { homedir } from "node:os";
import { runCli } from "./cli.ts";

process.exitCode = await runCli(process.argv.slice(2), {
  env: process.env,
  home: homedir(),
  stdout: (text) => void process.stdout.write(text),
  stderr: (text) => void process.stderr.write(text),
});
