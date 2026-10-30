import type { BridgeEditionContext } from './bridge';
/** 标准版不提供口播落轨和私有语音识别。 */
export function installBridgeEdition({ electron }: BridgeEditionContext) {
  delete electron.publishToLinkReader;
  delete electron.stt;
}
