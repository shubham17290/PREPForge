#!/usr/bin/env node

import { runIngestionPipeline, printPipelineSummary } from '../src/ingestion/pipeline.js';

async function main() {
  const onlyArg = process.argv[2];
  const onlyFile = onlyArg && !onlyArg.startsWith('-') ? onlyArg : undefined;
  console.log('=== GATE PYQ PDF Ingestion Pipeline ===');
  if (onlyFile) console.log(`Single-file run: ${onlyFile}\n`);
  else console.log('Phase 12F.2 - Pilot Run\n');

  try {
    const result = onlyFile
      ? await runIngestionPipeline(onlyFile)
      : await (await import('../src/ingestion/pipeline.js')).runPilotPipeline();
    printPipelineSummary(result);

    if (result.report) {
      console.log('\n========== HUMAN REPORT ==========\n');
      console.log(result.report);
    }

    process.exit(0);
  } catch (error) {
    console.error('Pipeline failed:', error);
    process.exit(1);
  }
}

main();