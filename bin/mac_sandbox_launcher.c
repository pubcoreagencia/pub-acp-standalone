#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <unistd.h>
#include <stdint.h>

extern int sandbox_init(const char *profile, uint64_t flags, char **errorbuf);
extern void sandbox_free_error(char *errorbuf);

int main(int argc, char **argv) {
    if (argc < 3) {
        fprintf(stderr, "Usage: %s <profile-string> <cmd> [args...]\n", argv[0]);
        return 127;
    }

    const char *profile = argv[1];
    char *err = NULL;

    if (sandbox_init(profile, 0, &err) != 0) {
        fprintf(stderr, "mac_sandbox_launcher: sandbox_init failed: %s\n", err ? err : "unknown error");
        if (err) {
            sandbox_free_error(err);
        }
        return 126;
    }

    // Execute target command
    char **cmd_argv = &argv[2];
    execvp(cmd_argv[0], cmd_argv);

    // If execvp returns, it failed
    perror("execvp failed");
    return 127;
}
