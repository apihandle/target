#!/usr/bin/env python3
"""
TARGET job supervisor (fix #1): wraps ONE sandboxed program inside its job dir.

Why this exists: a job can escape the worker's cleanup by calling setsid (new process group, so the
worker's group kill misses it) and detaching; when its parent then exits, the escapee is reparented to
PID 1 and the worker can no longer even see it in /proc (yama ptrace_scope=1 hides non-descendants,
and a uid-dropped process's cwd/environ are restricted).

The supervisor makes escape structurally impossible to survive:
  * It marks itself a child subreaper (PR_SET_CHILD_SUBREAPER), so orphaned descendants of the job are
    reparented to the SUPERVISOR, never to PID 1 — they stay visible and killable.
  * While the job runs it polls /proc every few ms and records every descendant of the job process,
    plus every process reparented to itself.
  * When the job exits (or the supervisor gets SIGTERM/SIGINT), it SIGKILLs everything it recorded,
    drains briefly for late orphans to reparent, kills and reaps those too, then exits with the job's
    exact exit status — re-raising the job's killing signal on itself when the job died by one, so the
    worker sees the same code/signal as if it had spawned the job directly.

Usage: job-supervisor.py <cmd> [args...]   (cwd/env are inherited from the worker's sandbox spawn)
"""
import ctypes
import os
import signal
import subprocess
import sys
import time

PR_SET_CHILD_SUBREAPER = 36
POLL_S = 0.005
DRAIN_S = 0.35


def ppid_map():
    out = {}
    for name in os.listdir("/proc"):
        if not name.isdigit():
            continue
        try:
            with open(f"/proc/{name}/stat", "rb") as f:
                rest = f.read().rsplit(b")", 1)[1].split()
            out[int(name)] = int(rest[1])  # fields after comm: state, ppid, ...
        except Exception:
            continue
    return out


def collect(child_pid, me):
    """All pids belonging to the job right now: descendants of the job process, plus orphans adopted by me."""
    ppids = ppid_map()
    found = {p for p, pp in ppids.items() if pp == me and p != child_pid}
    frontier = {child_pid} | found
    grew = True
    while grew:
        grew = False
        for pid, pp in ppids.items():
            if pp in frontier and pid not in found and pid != child_pid:
                found.add(pid)
                frontier.add(pid)
                grew = True
    return found


def kill_all(pids):
    for pid in pids:
        try:
            os.kill(pid, signal.SIGKILL)
        except Exception:
            pass


def reap_all(deadline_s):
    """Reap adopted children (and any zombie) until none are left or the deadline passes."""
    end = time.time() + deadline_s
    while time.time() < end:
        try:
            pid, _ = os.waitpid(-1, os.WNOHANG)
        except ChildProcessError:
            return
        if pid <= 0:
            time.sleep(0.01)


def main():
    if len(sys.argv) < 2:
        print("usage: job-supervisor.py <cmd> [args...]", file=sys.stderr)
        return 127
    try:
        ctypes.CDLL(None, use_errno=True).prctl(PR_SET_CHILD_SUBREAPER, 1, 0, 0, 0)
    except Exception:
        pass  # best effort: descendant tracking below still applies

    me = os.getpid()
    child = subprocess.Popen(sys.argv[1:])
    tracked = set()
    stopping = []

    def on_signal(signum, _frame):
        stopping.append(signum)

    signal.signal(signal.SIGTERM, on_signal)
    signal.signal(signal.SIGINT, on_signal)

    rc = None
    while True:
        rc = child.poll()
        tracked |= collect(child.pid, me)
        if stopping:
            break
        if rc is not None:
            # Drain: orphans reparent to us as their parents die; collect for a brief window so a
            # process spawned-and-abandoned in the job's last moments is still caught.
            end = time.time() + DRAIN_S
            while time.time() < end:
                tracked |= collect(child.pid, me)
                time.sleep(POLL_S)
            break
        time.sleep(POLL_S)

    if stopping and child.poll() is None:
        kill_all({child.pid})
    kill_all(tracked)
    # Second drain after the kill: killing a tracked parent can orphan ITS children onto us.
    end = time.time() + DRAIN_S
    while time.time() < end:
        late = collect(child.pid, me)
        if not late:
            break
        kill_all(late)
        time.sleep(POLL_S)
    if child.poll() is None:
        try:
            child.wait(timeout=1)
        except Exception:
            kill_all({child.pid})
    reap_all(0.5)

    if stopping:
        return 124
    rc = child.returncode if child.returncode is not None else 0
    if rc < 0:  # job died by signal: die the same way so the worker observes the same signal
        sig = -rc
        try:
            signal.signal(sig, signal.SIG_DFL)
            os.kill(me, sig)
        except Exception:
            pass
        return 128 + sig
    return rc


if __name__ == "__main__":
    sys.exit(main())
