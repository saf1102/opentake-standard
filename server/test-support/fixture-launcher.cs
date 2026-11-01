// Test-only Windows native executable for JavaScript fake CLIs. Its child belongs
// to a kill-on-close job, so cancelling the fixture never leaves a Node process.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Reflection;
class FixtureLauncher {
 [StructLayout(LayoutKind.Sequential)] struct Basic {
  public long ProcessTime, JobTime; public uint Flags;
  public UIntPtr Minimum, Maximum; public uint Active; public UIntPtr Affinity;
  public uint Priority, Scheduling;
 }
 [StructLayout(LayoutKind.Sequential)] struct Io { public ulong A,B,C,D,E,F; }
 [StructLayout(LayoutKind.Sequential)] struct Limits {
  public Basic Basic; public Io Io; public UIntPtr ProcessMemory,JobMemory,PeakProcess,PeakJob;
 }
 [DllImport("kernel32.dll",CharSet=CharSet.Unicode)] static extern IntPtr CreateJobObject(IntPtr attributes,string name);
 [DllImport("kernel32.dll")] static extern bool SetInformationJobObject(IntPtr job,int type,ref Limits info,uint size);
 [DllImport("kernel32.dll")] static extern bool AssignProcessToJobObject(IntPtr job,IntPtr process);
 [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
 static string Quote(string value) {
  var result=new System.Text.StringBuilder("\""); int slashes=0;
  foreach(char c in value) {
   if(c=='\\'){slashes++;continue;}
   if(c=='\"')result.Append('\\',slashes*2+1);else result.Append('\\',slashes);
   result.Append(c);slashes=0;
  }
  return result.Append('\\',slashes*2).Append('"').ToString();
 }
 static Thread Pump(Stream input,Stream output) {
  var t=new Thread(()=>{try{input.CopyTo(output);output.Flush();}catch(IOException){}catch(ObjectDisposedException){} });
  t.IsBackground=true;t.Start();return t;
 }
 static int Main(string[] args) {
  string self=Assembly.GetExecutingAssembly().Location;
  var start=new ProcessStartInfo(File.ReadAllText(self+".node-path"),Quote(File.ReadAllText(self+".script-path"))+" "+String.Join(" ",args.Select(Quote)));
  start.UseShellExecute=false;start.CreateNoWindow=true;start.RedirectStandardInput=true;start.RedirectStandardOutput=true;start.RedirectStandardError=true;
  IntPtr job=CreateJobObject(IntPtr.Zero,null);var limits=new Limits();limits.Basic.Flags=0x2000;
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new InvalidOperationException("Cannot contain test process");
  try {using(var child=Process.Start(start)) {
   if(!AssignProcessToJobObject(job,child.Handle)){child.Kill();throw new InvalidOperationException("Cannot contain test child");}
   var input=new Thread(()=>{try{Console.OpenStandardInput().CopyTo(child.StandardInput.BaseStream);child.StandardInput.Close();}catch(IOException){}catch(ObjectDisposedException){} });input.IsBackground=true;input.Start();
   var stdout=Pump(child.StandardOutput.BaseStream,Console.OpenStandardOutput());var stderr=Pump(child.StandardError.BaseStream,Console.OpenStandardError());
   child.WaitForExit();stdout.Join();stderr.Join();return child.ExitCode;
  }}finally{CloseHandle(job);}
 }
}
