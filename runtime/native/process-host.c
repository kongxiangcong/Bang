/* Private supervisor protocol: decimal byte count, LF, exact UTF-8 payload.
 * Subsequent stdin EOF requests cooperative stop. No shell is involved.
 * stdout is the worker result; stderr contains only a fixed numeric receipt. */
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#ifdef _WIN32
#ifndef UNICODE
#define UNICODE
#endif
#undef _WIN32_WINNT
#define _WIN32_WINNT 0x0600
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <io.h>
#include <fcntl.h>
static HANDLE worker_input,stop_event;
static char *payload;static unsigned length;
static DWORD WINAPI feed(void *unused){DWORD n;unsigned offset=0;while(offset<length&&WriteFile(worker_input,payload+offset,length-offset,&n,NULL)&&n)offset+=n;return 0;}
static DWORD WINAPI control(void *unused){char c;DWORD n;while(ReadFile(GetStdHandle(STD_INPUT_HANDLE),&c,1,&n,NULL)&&n){}SetEvent(stop_event);return 0;}
static void quote(wchar_t **out,const wchar_t *s){*(*out)++=L'"';unsigned n=0;for(;*s;s++){if(*s==L'\\'){n++;continue;}for(unsigned i=0;i<n*( *s==L'"'?2:1)+( *s==L'"'?1:0);i++)*(*out)++=L'\\';n=0;*(*out)++=*s;}for(unsigned i=0;i<n*2;i++)*(*out)++=L'\\';*(*out)++=L'"';}
int wmain(int argc,wchar_t **argv){
 if(argc<4)return 64;
 unsigned grace=wcstoul(argv[1],NULL,10),timeout=wcstoul(argv[2],NULL,10);
 _setmode(_fileno(stdin),_O_BINARY);setvbuf(stdin,NULL,_IONBF,0);
 if(scanf("%u",&length)!=1||length>1048576||getchar()!='\n')return 64;
 payload=malloc(length);if(!payload||fread(payload,1,length,stdin)!=length)return 64;
 HANDLE job=CreateJobObjectW(NULL,NULL);if(!job)return 74;
 JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
 if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))return 74;
 SECURITY_ATTRIBUTES sa={sizeof(sa),NULL,TRUE};HANDLE input_read;
 if(!CreatePipe(&input_read,&worker_input,&sa,0))return 74;
 SetHandleInformation(worker_input,HANDLE_FLAG_INHERIT,0);
 size_t size=1;for(int i=3;i<argc;i++)size+=wcslen(argv[i])*2+4;
 wchar_t *cmd=calloc(size,sizeof(wchar_t)),*p=cmd;if(!cmd)return 74;
 for(int i=3;i<argc;i++){if(i>3)*p++=L' ';quote(&p,argv[i]);}
 STARTUPINFOW si={0};si.cb=sizeof(si);si.dwFlags=STARTF_USESTDHANDLES;si.hStdInput=input_read;si.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);si.hStdError=GetStdHandle(STD_ERROR_HANDLE);PROCESS_INFORMATION pi={0};
 if(!CreateProcessW(argv[3],cmd,NULL,NULL,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW,NULL,NULL,&si,&pi))return 74;
 if(!AssignProcessToJobObject(job,pi.hProcess)){TerminateProcess(pi.hProcess,74);return 74;}
 stop_event=CreateEventW(NULL,TRUE,FALSE,NULL);HANDLE feeder=CreateThread(NULL,0,feed,NULL,0,NULL),reader=CreateThread(NULL,0,control,NULL,0,NULL);
 if(!stop_event||!feeder||!reader||ResumeThread(pi.hThread)==(DWORD)-1){TerminateJobObject(job,74);return 74;}
 CloseHandle(pi.hThread);CloseHandle(input_read);
 HANDLE waits[2]={pi.hProcess,stop_event};DWORD result=WaitForMultipleObjects(2,waits,FALSE,timeout),status=0;int stopped=result!=WAIT_OBJECT_0,forced=0;
 DWORD stopping_at=GetTickCount();
 if(stopped){CancelSynchronousIo(feeder);WaitForSingleObject(feeder,100);CloseHandle(worker_input);worker_input=NULL;WaitForSingleObject(pi.hProcess,grace);}
 JOBOBJECT_BASIC_ACCOUNTING_INFORMATION info;
 if(!QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&info,sizeof(info),NULL))return 74;
 {DWORD settle=stopping_at;while(info.ActiveProcesses&&GetTickCount()-settle<grace){Sleep(5);if(!QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&info,sizeof(info),NULL))return 74;}}
 if(info.ActiveProcesses){forced=1;TerminateJobObject(job,137);}
 DWORD start=GetTickCount();do{if(!QueryInformationJobObject(job,JobObjectBasicAccountingInformation,&info,sizeof(info),NULL))return 74;if(!info.ActiveProcesses)break;Sleep(5);}while(GetTickCount()-start<5000);
 if(info.ActiveProcesses)return 75;
 GetExitCodeProcess(pi.hProcess,&status);
 fprintf(stderr,"\nBANG_PROCESS exited=1 forced=%d stopped=%d timeout=%d code=%lu\n",forced,stopped,result==WAIT_TIMEOUT,status);
 CloseHandle(job);CloseHandle(pi.hProcess);return 0;
}
#else
#define _GNU_SOURCE
#include <unistd.h>
#include <signal.h>
#include <poll.h>
#include <sys/wait.h>
#include <sys/prctl.h>
#include <time.h>
#include <errno.h>
#include <fcntl.h>
static long long now(void){struct timespec t;clock_gettime(CLOCK_MONOTONIC,&t);return t.tv_sec*1000LL+t.tv_nsec/1000000;}
int main(int argc,char **argv){
 if(argc<4)return 64;
 unsigned length;setvbuf(stdin,NULL,_IONBF,0);
 if(scanf("%u",&length)!=1||length>1048576||getchar()!='\n')return 64;
 char *payload=malloc(length);if(!payload||fread(payload,1,length,stdin)!=length)return 64;
 unsigned grace=strtoul(argv[1],NULL,10),timeout=strtoul(argv[2],NULL,10);int input[2];if(pipe(input))return 74;
 if(prctl(PR_SET_CHILD_SUBREAPER,1))return 74;
 pid_t child=fork();if(child<0)return 74;
 if(!child){setpgid(0,0);close(input[1]);dup2(input[0],0);close(input[0]);execv(argv[3],argv+3);_exit(127);}
 setpgid(child,child);close(input[0]);signal(SIGPIPE,SIG_IGN);
 /* bounded, nonblocking payload forwarding also keeps cancellation responsive */
 int flags=fcntl(input[1],F_GETFL);fcntl(input[1],F_SETFL,flags|O_NONBLOCK);
 unsigned offset=0;int status=0,leader_done=0,stopped=0,forced=0,timed=0,remaining=1;long long start=now(),stop_at=0;
 while(remaining){
  int s;pid_t reaped;while((reaped=waitpid(-1,&s,WNOHANG))>0){if(reaped==child){status=s;leader_done=1;}}
  if(reaped<0&&errno==ECHILD){remaining=0;break;}
  struct pollfd control={0,POLLIN|POLLHUP,0};poll(&control,1,5);
  if(!stop_at&&(leader_done||control.revents||now()-start>=timeout)){timed=now()-start>=timeout;stopped=!leader_done;stop_at=now();close(input[1]);input[1]=-1;kill(-child,SIGTERM);}
  if(stop_at&&now()-stop_at>=grace&&!forced){forced=1;kill(-child,SIGKILL);}
  if(stop_at&&now()-stop_at>grace+5000)return 75;
  if(input[1]>=0&&offset<length){ssize_t n=write(input[1],payload+offset,length-offset);if(n>0)offset+=n;}
 }
 fprintf(stderr,"\nBANG_PROCESS exited=1 forced=%d stopped=%d timeout=%d code=%d\n",forced,stopped,timed,WIFEXITED(status)?WEXITSTATUS(status):128+WTERMSIG(status));return 0;
}
#endif


