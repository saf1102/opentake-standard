// Test-only Windows native executable for JavaScript fake CLIs. Its child belongs
// to a kill-on-close job, so cancelling the fixture never leaves a Node process.
using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
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
 static int Main(string[] args) {
  string self=Assembly.GetExecutingAssembly().Location;
  var start=new ProcessStartInfo(File.ReadAllText(self+".node-path"),Quote(File.ReadAllText(self+".script-path"))+" "+String.Join(" ",args.Select(Quote)));
  start.UseShellExecute=false;start.CreateNoWindow=true;
  // Redirecting just stderr makes .NET Framework set STARTF_USESTDHANDLES with
  // the original stdin/stdout handles. No text preamble, stdin pump or extra EOF.
  start.RedirectStandardError=true;
  IntPtr job=CreateJobObject(IntPtr.Zero,null);var limits=new Limits();limits.Basic.Flags=0x2000;
  if(job==IntPtr.Zero||!SetInformationJobObject(job,9,ref limits,(uint)Marshal.SizeOf(limits)))throw new InvalidOperationException("Cannot contain test process");
  try {using(var child=Process.Start(start)) {
   if(!AssignProcessToJobObject(job,child.Handle)){child.Kill();throw new InvalidOperationException("Cannot contain test child");}
   child.StandardError.BaseStream.CopyTo(Console.OpenStandardError());
   child.WaitForExit();
   return child.ExitCode;
  }}finally{CloseHandle(job);}
 }
}
