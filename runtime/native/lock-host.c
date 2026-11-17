/* The lock is never unlinked. Its lifetime is an OS handle, never a PID lease. */
#ifdef _WIN32
#ifndef UNICODE
#define UNICODE
#endif
#define _UNICODE
#include <windows.h>
#include <wchar.h>
#include <stdio.h>
static void quote(wchar_t **out,const wchar_t *s){*(*out)++=L'"';unsigned slashes=0;for(;*s;s++){if(*s==L'\\'){slashes++;continue;}if(*s==L'"'){for(unsigned i=0;i<slashes*2+1;i++)*(*out)++=L'\\';}else{for(unsigned i=0;i<slashes;i++)*(*out)++=L'\\';}slashes=0;*(*out)++=*s;}for(unsigned i=0;i<slashes*2;i++)*(*out)++=L'\\';*(*out)++=L'"';}
static int failure(const char *stage){fprintf(stderr,"BANG_START stage=%s code=%lu\n",stage,GetLastError());return 74;}
int wmain(int argc,wchar_t **argv){
 if(argc<4)return 64;
 SECURITY_ATTRIBUTES sa={sizeof(sa),NULL,TRUE};
 HANDLE lock=CreateFileW(argv[1],GENERIC_READ|GENERIC_WRITE,0,&sa,OPEN_ALWAYS,FILE_ATTRIBUTE_NORMAL,NULL);
 if(lock==INVALID_HANDLE_VALUE)return GetLastError()==ERROR_SHARING_VIOLATION?73:failure("lock-open");
 HANDLE job=CreateJobObjectW(NULL,NULL);if(!job)return failure("job-create");
 JOBOBJECT_EXTENDED_LIMIT_INFORMATION limits={0};limits.BasicLimitInformation.LimitFlags=JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;
 if(!SetInformationJobObject(job,JobObjectExtendedLimitInformation,&limits,sizeof(limits)))return failure("job-configure");
 size_t n=1;for(int i=2;i<argc;i++)n+=2*wcslen(argv[i])+4;
 wchar_t *cmd=calloc(n,sizeof(wchar_t));if(!cmd){SetLastError(ERROR_NOT_ENOUGH_MEMORY);return failure("command-allocate");}wchar_t *cursor=cmd;for(int i=2;i<argc;i++){if(i>2)*cursor++=L' ';quote(&cursor,argv[i]);}*cursor=0;
 STARTUPINFOW si={0};si.cb=sizeof(si);si.dwFlags=STARTF_USESTDHANDLES;si.hStdInput=GetStdHandle(STD_INPUT_HANDLE);si.hStdOutput=GetStdHandle(STD_OUTPUT_HANDLE);si.hStdError=GetStdHandle(STD_ERROR_HANDLE);PROCESS_INFORMATION pi={0};
 wchar_t owner[32];swprintf(owner,32,L"%lu",GetCurrentProcessId());SetEnvironmentVariableW(L"BANG_NATIVE_LOCK_OWNER",owner);
 if(!CreateProcessW(NULL,cmd,NULL,NULL,TRUE,CREATE_SUSPENDED|CREATE_NO_WINDOW,NULL,NULL,&si,&pi))return failure("daemon-create");
 if(!AssignProcessToJobObject(job,pi.hProcess)){DWORD error=GetLastError();TerminateProcess(pi.hProcess,74);SetLastError(error);return failure("job-assign");}
 if(ResumeThread(pi.hThread)==(DWORD)-1){DWORD error=GetLastError();TerminateProcess(pi.hProcess,74);SetLastError(error);return failure("daemon-resume");}CloseHandle(pi.hThread);WaitForSingleObject(pi.hProcess,INFINITE);
 DWORD status=0;GetExitCodeProcess(pi.hProcess,&status);CloseHandle(pi.hProcess);CloseHandle(job);CloseHandle(lock);free(cmd);return (int)status;
}
#else
#include <sys/file.h>
#include <fcntl.h>
#include <unistd.h>
#include <errno.h>
#include <stdlib.h>
#include <stdio.h>
static int failure(const char *stage){fprintf(stderr,"BANG_START stage=%s code=%d\n",stage,errno);return 74;}
int main(int argc,char **argv){if(argc<4)return 64;int fd=open(argv[1],O_RDWR|O_CREAT,0600);if(fd<0)return failure("lock-open");if(flock(fd,LOCK_EX|LOCK_NB))return errno==EWOULDBLOCK?73:failure("lock-acquire");char owner[32];snprintf(owner,sizeof(owner),"%ld",(long)getpid());setenv("BANG_NATIVE_LOCK_OWNER",owner,1);execv(argv[2],argv+2);return failure("daemon-exec");}
#endif

