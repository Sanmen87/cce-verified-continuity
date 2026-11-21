/** Process completion, output observations and verification authority are separate.
 * These signatures diagnose contradictions; they never prove that a test passed. */
export function observeExecution(exitCode:number|null,isError:boolean,diagnostic:string,termination='completed') {
  const known=Number.isSafeInteger(exitCode)&&exitCode!==null&&exitCode>=0;
  const processOutcome=termination!=='completed'||!known?'UNKNOWN':exitCode===0?'SUCCEEDED':'FAILED';
  const signals:string[]=[];
  if(/^\s*Traceback \(most recent call last\):/m.test(diagnostic))signals.push('PYTHON_TRACEBACK');
  if(/^FAILED \([^\n]*(?:failures|errors)=\d+/m.test(diagnostic))signals.push('UNITTEST_FAILURE');
  if(/^=+[^\n]*\b[1-9]\d* (?:failed|errors?)\b[^\n]*=+$/m.test(diagnostic))signals.push('PYTEST_FAILURE');
  const observedOutcome=processOutcome==='UNKNOWN'?'UNKNOWN':processOutcome==='FAILED'||isError?'FAIL':signals.length?'CONTRADICTORY':'UNKNOWN';
  return {exitCode,processOutcome,observedOutcome,signals,authority:'OUTPUT_OBSERVATION_ONLY' as const};
}
