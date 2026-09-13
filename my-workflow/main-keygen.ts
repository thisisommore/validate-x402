import {
  cre,
  Runner,
  handlerInTee,
  type TeeRuntime,
  type HTTPPayload,
} from "@chainlink/cre-sdk";

const onHttpTrigger = async (
  runtime: TeeRuntime<Record<string, never>>,
  _payload: HTTPPayload,
): Promise<string> => {
  const probe: Record<string, unknown> = {
    atob: typeof atob,
    btoa: typeof btoa,
    Buffer: typeof Buffer,
    TextDecoder: typeof TextDecoder,
    TextEncoder: typeof TextEncoder,
    evalSeesGlobals: "untested",
  };
  try {
    probe.atobWorks = atob("e30=");
  } catch (e) {
    probe.atobWorks = String(e);
  }
  try {
    probe.evalSeesGlobals = await eval("(async function() { return typeof atob; })()");
  } catch (e) {
    probe.evalSeesGlobals = String(e);
  }
  try {
    probe.bufferB64 = await eval(
      "(async function() { const b = Buffer.from('iVBORw0KGgo=', 'base64'); return b[0] === 137 && b[1] === 80 && b.length === 8; })()",
    );
  } catch (e) {
    probe.bufferB64 = String(e);
  }
  return JSON.stringify(probe);
};

const initWorkflow = () => {
  const http = new cre.capabilities.HTTPCapability();
  return [handlerInTee(http.trigger({}), onHttpTrigger, {})];
};

export async function main() {
  const runner = await Runner.newRunner<Record<string, never>>();
  await runner.run(initWorkflow);
}

main();
