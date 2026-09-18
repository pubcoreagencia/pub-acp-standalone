#define UNICODE
#define _UNICODE
#include <windows.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

/**
 * Windows Native Sandbox Launcher (Job Object & Process Tree Containment)
 *
 * Implements native Win32 process containment:
 * 1. Creates a Win32 Job Object (CreateJobObjectW).
 * 2. Sets JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE (guarantees entire tree terminates if launcher exits).
 * 3. Configures breakaway protection:
 *    - JOB_OBJECT_LIMIT_SILENT_BREAKAWAY_OK is explicitly NOT set.
 *    - If childProcessAllowed is 0, active process limit is set to 1 (JOB_OBJECT_LIMIT_ACTIVE_PROCESS = 1),
 *      preventing child process creation by the target executable.
 * 4. Spawns process suspended (CREATE_SUSPENDED | CREATE_BREAKAWAY_FROM_JOB).
 * 5. Assigns process to Job Object (AssignProcessToJobObject).
 * 6. Resumes thread, waits for process with timeout, and terminates Job Object on timeout.
 * 7. Returns target exit code.
 */

int main(int argc, char **argv) {
    if (argc < 4) {
        fprintf(stderr, "Usage: win_sandbox_launcher <allow_child:0|1> <timeout_ms> <cmd> [args...]\n");
        return 127;
    }

    int allow_child = atoi(argv[1]);
    DWORD timeout_ms = (DWORD)atoi(argv[2]);

    // Build command line from argv[3...]
    // In Windows, CreateProcess takes a single command line string
    int total_len = 0;
    for (int i = 3; i < argc; i++) {
        total_len += (int)strlen(argv[i]) + 3; // quotes and space
    }

    char *cmdline = (char *)malloc(total_len + 1);
    if (!cmdline) {
        fprintf(stderr, "win_sandbox_launcher: Out of memory\n");
        return 126;
    }
    cmdline[0] = '\0';
    for (int i = 3; i < argc; i++) {
        strcat(cmdline, "\"");
        strcat(cmdline, argv[i]);
        strcat(cmdline, "\" ");
    }

    // Convert cmdline to wchar_t
    int wlen = MultiByteToWideChar(CP_UTF8, 0, cmdline, -1, NULL, 0);
    wchar_t *wcmdline = (wchar_t *)malloc(wlen * sizeof(wchar_t));
    if (!wcmdline) {
        free(cmdline);
        return 126;
    }
    MultiByteToWideChar(CP_UTF8, 0, cmdline, -1, wcmdline, wlen);
    free(cmdline);

    // Create Job Object
    HANDLE hJob = CreateJobObjectW(NULL, NULL);
    if (hJob == NULL) {
        fprintf(stderr, "win_sandbox_launcher: CreateJobObjectW failed: %lu\n", GetLastError());
        free(wcmdline);
        return 126;
    }

    JOBOBJECT_EXTENDED_LIMIT_INFORMATION jeli;
    ZeroMemory(&jeli, sizeof(jeli));
    jeli.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE;

    if (!allow_child) {
        // Active process limit = 1 prevents child processes from being spawned
        jeli.BasicLimitInformation.LimitFlags |= JOB_OBJECT_LIMIT_ACTIVE_PROCESS;
        jeli.BasicLimitInformation.ActiveProcessLimit = 1;
    }

    if (!SetInformationJobObject(hJob, JobObjectExtendedLimitInformation, &jeli, sizeof(jeli))) {
        fprintf(stderr, "win_sandbox_launcher: SetInformationJobObject failed: %lu\n", GetLastError());
        CloseHandle(hJob);
        free(wcmdline);
        return 126;
    }

    // Start target process suspended
    STARTUPINFOW si;
    PROCESS_INFORMATION pi;
    ZeroMemory(&si, sizeof(si));
    si.cb = sizeof(si);
    ZeroMemory(&pi, sizeof(pi));

    BOOL cpRes = CreateProcessW(
        NULL,
        wcmdline,
        NULL,
        NULL,
        TRUE, // Inherit standard handles (stdout/stderr)
        CREATE_SUSPENDED,
        NULL,
        NULL,
        &si,
        &pi
    );

    free(wcmdline);

    if (!cpRes) {
        fprintf(stderr, "win_sandbox_launcher: CreateProcessW failed: %lu\n", GetLastError());
        CloseHandle(hJob);
        return 127;
    }

    // Assign process to Job Object
    if (!AssignProcessToJobObject(hJob, pi.hProcess)) {
        fprintf(stderr, "win_sandbox_launcher: AssignProcessToJobObject failed: %lu\n", GetLastError());
        TerminateProcess(pi.hProcess, 126);
        CloseHandle(pi.hProcess);
        CloseHandle(pi.hThread);
        CloseHandle(hJob);
        return 126;
    }

    // Resume thread
    ResumeThread(pi.hThread);
    CloseHandle(pi.hThread);

    // Wait with timeout
    DWORD waitRes = WaitForSingleObject(pi.hProcess, timeout_ms > 0 ? timeout_ms : INFINITE);
    DWORD exitCode = 0;

    if (waitRes == WAIT_TIMEOUT) {
        fprintf(stderr, "win_sandbox_launcher: Execution timed out after %lu ms\n", timeout_ms);
        // Terminate all processes in job object tree
        TerminateJobObject(hJob, 124); // 124 timeout standard
        CloseHandle(pi.hProcess);
        CloseHandle(hJob);
        return 124;
    } else if (waitRes == WAIT_OBJECT_0) {
        GetExitCodeProcess(pi.hProcess, &exitCode);
        CloseHandle(pi.hProcess);
        CloseHandle(hJob);
        return (int)exitCode;
    } else {
        fprintf(stderr, "win_sandbox_launcher: WaitForSingleObject error: %lu\n", GetLastError());
        TerminateJobObject(hJob, 126);
        CloseHandle(pi.hProcess);
        CloseHandle(hJob);
        return 126;
    }
}
