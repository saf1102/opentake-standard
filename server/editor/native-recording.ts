import fs from 'node:fs';
import {atomicJsonSync} from '../file-ops.ts';
import {StringDecoder} from 'node:string_decoder';
import {spawn, type ChildProcessWithoutNullStreams} from 'node:child_process';
import platform from '../platform.ts';

export type NativeRecordingState = {
  projectId: string; id: string; sourceName: string;
  phase: 'starting' | 'recording' | 'stopping' | 'saved' | 'failed';
  startedAt?: number; finishedAt?: number; durationSeconds?: number; error?: string;
};
type Launch = {
  projectId: string; id: string; sourceName: string; executable: string;
  args: string[]; env: NodeJS.ProcessEnv; projectFile: string; durationSeconds?: number; diagnosticFile?: string;
};
type Active = {
  child: ChildProcessWithoutNullStreams; state: NativeRecordingState; projectFile: string;
  stopRequested: boolean; stopSent: boolean; successful: boolean; error: string;
  stateError?: string; fatalError?: string; stderr: string; events: Record<string,unknown>[];
  startupTimer?: ReturnType<typeof setTimeout>; stopTimer?: ReturnType<typeof setTimeout>;
};

/** The installed recorder owns capture, cursor telemetry and project creation.
 * Stopping is its documented stdin protocol, never a process kill on success. */
export class NativeRecordingController {
  private active: Active | null = null;
  private last: NativeRecordingState | null = null;
  private options: {
    onState: (state: NativeRecordingState) => void;
    onStateError?: (state: NativeRecordingState) => void;
    startTimeoutMs?: number; stopTimeoutMs?: number;
    terminate?: (pid: number) => void;
    finalize?: (input: Launch) => Promise<void>;
  };
  constructor(options: NativeRecordingController['options']) { this.options=options; }

  get state() { return this.active?.state ?? this.last; }
  get busy() { return Boolean(this.active); }
  private publish(recording: Active) {
    this.last = {...recording.state};
    try { this.options.onState({...recording.state}); }
    catch(error) {
      recording.stateError = `保存录制状态失败：${error instanceof Error ? error.message : String(error)}；原始录制文件保留。`;
      recording.state.error = recording.stateError;
      const running = recording.child.exitCode === null && recording.child.signalCode === null;
      recording.state.phase = running ? 'stopping' : 'failed';
      this.last = {...recording.state};
      try { this.options.onStateError?.({...recording.state}); } catch { /* notification must not break process cleanup */ }
      // Preserve the normal save protocol even if state persistence fails.
      if(running) {recording.stopRequested=true;if(recording.state.startedAt)this.sendStop(recording);}
    }
  }
  private fail(recording: Active, message: string) {
    if (this.active !== recording) return;
    recording.error = message;
    // Timeouts terminate only this owned process tree. Keep every raw artifact.
    if (recording.child.pid && recording.child.exitCode===null && recording.child.signalCode===null)
      try{(this.options.terminate ?? platform.killTree)(recording.child.pid)}catch(error){recording.error+=`；结束录制进程失败：${error instanceof Error?error.message:String(error)}`}
  }
  private sendStop(recording: Active) {
    if (recording.stopSent) return;
    recording.stopSent = true;
    recording.child.stdin.write('stop\n', error => {
      if (error && this.active === recording) this.fail(recording, '无法向录制进程发送停止请求；录制文件已保留。');
    });
    recording.stopTimer = setTimeout(() => this.fail(recording,
      'OpenScreen 保存超时，已结束本次所属进程；原始录制文件已保留。'), this.options.stopTimeoutMs ?? 75_000);
    recording.stopTimer.unref();
  }
  start(input: Launch) {
    if (this.active) throw Error('已有录制正在启动、录制或保存，请先停止并保存。');
    const state: NativeRecordingState = {projectId:input.projectId,id:input.id,sourceName:input.sourceName,phase:'starting',durationSeconds:input.durationSeconds};
    // Validate initial persistence before creating a recorder. A failure here is
    // returned by the API, with no orphan capture process left in the background.
    try { this.options.onState({...state}); } catch(error) {
      this.last={...state,phase:'failed',error:`无法开始录制：${error instanceof Error?error.message:String(error)}`};
      try{this.options.onStateError?.({...this.last})}catch{}
      throw error;
    }
    const env = {...input.env};
    delete env.ELECTRON_RUN_AS_NODE;
    delete env.OPENSCREEN_COMPOSITOR_VIEW_NODE;
    const child = spawn(input.executable, input.args, {env, detached: true, windowsHide: true, stdio: 'pipe'});
    const recording: Active = {
      child, state,
      projectFile: input.projectFile, stopRequested: false, stopSent: false, successful: false, error: '', stderr:'', events:[],
    };
    this.active = recording;
    this.last={...state};
    let pending = '';
    const decoder=new StringDecoder('utf8');
    child.stdin.on('error', () => {}); // close/error is handled below, including early exits
    const stderrDecoder=new StringDecoder('utf8');
    child.stderr.on('data', chunk => {
      const text=stderrDecoder.write(chunk);
      recording.stderr=(recording.stderr+text).slice(-64_000);
      recording.error=(recording.error+text).slice(-2_000);
      // These are the helper's terminal startup failures, after its internal
      // encoder fallbacks. Individual HRESULTs and warnings can be recoverable.
      if(!recording.state.startedAt && !recording.fatalError && /ERROR: Failed to initialize (?:Media Foundation encoder|WGC (?:window|display) session)/.test(recording.stderr)){
        const details=recording.stderr.split(/\r?\n/).filter(line=>/SetInputMediaType|encoder-format|capture-format|hr=0x|ERROR: Failed to initialize/.test(line)).slice(-8).join('\n');
        recording.fatalError=`原生录制初始化失败：${details.slice(-1600)}；原始文件和诊断已保留。`;
        clearTimeout(recording.startupTimer);
        this.fail(recording,recording.fatalError);
      }
    });
    child.stderr.once('end',()=>{recording.stderr=(recording.stderr+stderrDecoder.end()).slice(-64_000)});
    const receive=(text:string)=>{
      pending += text;
      if (pending.length > 2_000_000) return this.fail(recording, 'OpenScreen 返回的数据过大，已保留原始录制文件。');
      for (;;) {
        const index = pending.indexOf('\n');
        if (index < 0) break;
        const line = pending.slice(0, index); pending = pending.slice(index + 1);
        let event: Record<string, unknown>;
        try { event = JSON.parse(line); } catch { continue; }
        if(!event||typeof event!=='object'||Array.isArray(event))continue;
        // Only the recorder's protocol fields, never its arguments/environment.
        recording.events.push(Object.fromEntries(['event','message','success','error'].filter(k=>k in event).map(k=>[k,event[k]])));
        if(recording.events.length>200)recording.events.shift();
        if (event.event === 'log' && event.message === 'Recording started') {
          clearTimeout(recording.startupTimer);
          recording.state.startedAt = Date.now();
          recording.state.phase = recording.stopRequested ? 'stopping' : 'recording';
          this.publish(recording);
          if (recording.stopRequested) this.sendStop(recording);
        }
        if (event.event === 'stopping') {
          recording.state.phase = 'stopping'; this.publish(recording);
          if (!recording.stopTimer) {
            recording.stopTimer = setTimeout(() => this.fail(recording, 'OpenScreen 保存超时，原始文件已保留。'), this.options.stopTimeoutMs ?? 75_000);
            recording.stopTimer.unref();
          }
        }
        if (event.event === 'error' && typeof event.message === 'string') recording.error = event.message;
        if (event.event === 'done') {
          recording.successful = event.success === true;
          if (!recording.successful && typeof event.error === 'string') recording.error = event.error;
        }
      }
    };
    child.stdout.on('data',chunk=>receive(decoder.write(chunk)));
    child.stdout.once('end',()=>{const tail=decoder.end();if(pending||tail)receive(tail+'\n')});
    child.once('error', error => { recording.error = error.message; });
    child.once('close', async (code,signal) => {
      clearTimeout(recording.startupTimer); clearTimeout(recording.stopTimer);
      let saved = code === 0 && recording.successful && fs.existsSync(recording.projectFile);
      if(saved&&this.options.finalize){
        recording.state.phase='stopping';this.publish(recording);
        try{await this.options.finalize(input)}catch(error){saved=false;recording.error=error instanceof Error?error.message:String(error)}
      }
      this.active = null;
      if(recording.stateError){saved=false;recording.error=recording.stateError;}
      recording.state.phase = saved ? 'saved' : 'failed';
      recording.state.finishedAt = Date.now();
      if (!saved) recording.state.error = recording.fatalError || recording.error.trim().slice(-1_200) || `OpenScreen 录制退出（${code ?? '未知'}），工程及原始文件已保留。`;
      this.publish(recording);
      if(input.diagnosticFile){
        try{atomicJsonSync(input.diagnosticFile,{schemaVersion:1,projectId:input.projectId,id:input.id,
          exit:{code,signal},state:recording.state,events:recording.events,stderr:recording.stderr})}
        catch(error){console.warn('无法保存本次录制诊断：',error instanceof Error?error.message:String(error))}
      }
    });
    recording.startupTimer = setTimeout(() => this.fail(recording,
      'OpenScreen 未能在时限内开始录制；请检查窗口是否仍打开及录屏权限。'), this.options.startTimeoutMs ?? 60_000);
    recording.startupTimer.unref();
    return {...recording.state};
  }
  stop(projectId: string, id: string) {
    const recording = this.active;
    if (!recording || recording.state.projectId !== projectId || recording.state.id !== id)
      throw Error('本次运行没有可控制的这段录制；未停止其他录制。');
    // A late click can arrive while ffprobe/document finalization is running.
    // Its recorder has already exited: never write to its closed pipe or reuse its PID.
    if(recording.child.exitCode!==null || recording.child.signalCode!==null)return {...recording.state};
    if (recording.stopRequested) return {...recording.state};
    recording.stopRequested = true;
    const started = Boolean(recording.state.startedAt);
    recording.state.phase = 'stopping'; this.publish(recording);
    if (started) this.sendStop(recording);
    return {...recording.state};
  }
}
