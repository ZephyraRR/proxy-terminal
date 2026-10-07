"""Linux entry point for cline-auto inside the container.

The real logic (screen watcher, "Continue" on network errors, rate-limit waits, model switching, session resume)
lives in the user's own cline_auto.py, which is copied in unchanged at build time. That file only differs on Windows
in how it owns a pseudo terminal (winpty + the Win32 console), so this file supplies the same pieces on Linux:
a PTY object with the winpty-like API the Watcher expects, plus the main loop.
"""
import codecs
import json
import os
import pty
import select
import shutil
import signal
import struct
import sys
import termios
import threading
import time
import tty
import fcntl

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cline_auto as ca  # noqa: E402

CLINE = os.environ.get("CLINE_BIN", "/usr/local/bin/cline")
ca.cline_command = lambda: [CLINE]


class LinuxPty:
    """The subset of winpty.PtyProcess that cline_auto.Watcher and main() use."""

    def __init__(self, args, rows, cols):
        pid, fd = pty.fork()
        if pid == 0:
            os.execvpe(args[0], args, dict(os.environ))
        self.pid, self.fd = pid, fd
        self.exitstatus = None
        self.decoder = codecs.getincrementaldecoder("utf-8")(errors="replace")
        self.setwinsize(rows, cols)

    def read(self, size=65536):
        ready, _, _ = select.select([self.fd], [], [], 0.5)
        if not ready:
            return ""
        try:
            data = os.read(self.fd, size)
        except OSError:
            raise EOFError
        if not data:
            raise EOFError
        return self.decoder.decode(data)

    def write(self, text):
        os.write(self.fd, text.encode("utf-8"))

    def isalive(self):
        if self.exitstatus is not None:
            return False
        try:
            pid, status = os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            self.exitstatus = 0
            return False
        if pid == 0:
            return True
        self.exitstatus = os.waitstatus_to_exitcode(status)
        return False

    def terminate(self, force=False):
        os.kill(self.pid, signal.SIGKILL if force else signal.SIGTERM)

    def setwinsize(self, rows, cols):
        fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))


def main():
    user_args = sys.argv[1:]
    out = sys.stdout.buffer
    data_dir_arg = ca.option_value(user_args, "--data-dir")
    ctx = ca.Context(user_args, ca.option_value(user_args, "--id"), ca.Path(data_dir_arg) if data_dir_arg else None)
    ca.choose_best_model_at_start(ctx.data_dir)

    class Holder:
        pty = None
        watcher = None

    holder = Holder()
    saved_tty = termios.tcgetattr(0)

    def finish(code):
        termios.tcsetattr(0, termios.TCSADRAIN, saved_tty)
        os._exit(code)

    def spawn(args, resume):
        size = shutil.get_terminal_size()
        p = LinuxPty(args, size.lines, size.columns)
        watcher = ca.Watcher(p, size.columns, size.lines, ctx, resume=resume)
        holder.pty, holder.watcher = p, watcher
        for target in (lambda: reader(p, watcher), watcher.run, lambda: supervise(p, watcher)):
            threading.Thread(target=target, daemon=True).start()

    def reader(p, watcher):
        while True:
            try:
                data = p.read()
            except Exception:
                return
            if not data:
                if not p.isalive():
                    return
                continue
            try:
                out.write(data.encode("utf-8", "replace"))
                out.flush()
            except OSError:
                return
            watcher.feed(data)

    def supervise(p, watcher):
        while p.isalive():
            time.sleep(0.3)
        time.sleep(0.6)
        request = watcher.restart
        if request is not None:
            restart(request)
            return
        finish(p.exitstatus or 0)

    def restart(request):
        ctx.session_id = request["session"]
        args = ca.cline_command() + ca.restart_args(ctx.user_args) + ["--id", request["session"]]
        ca.log(f"restarting Cline: {args[1:]}")
        out.write(f"\x1b[2J\x1b[3J\x1b[H\x1b[36m[cline-auto] model: {request['model']}, resuming session {request['session']}\x1b[0m\r\n".encode())
        out.flush()
        try:
            spawn(args, True)
        except Exception as exc:
            ca.log(f"could not restart Cline: {exc!r}")
            finish(1)

    def forward_input():
        decoder = codecs.getincrementaldecoder("utf-8")(errors="ignore")
        while True:
            chunk = os.read(0, 4096)
            if not chunk:
                break
            if holder.watcher is not None:
                holder.watcher.user_typed()
            text = decoder.decode(chunk)
            ca.note_typed(ctx, text)
            if text and holder.pty is not None:
                try:
                    holder.pty.write(text)
                except Exception as exc:
                    ca.log("write failed: " + repr(exc))

    def follow_size():
        last = (0, 0)
        while True:
            time.sleep(0.4)
            now = shutil.get_terminal_size()
            if (now.columns, now.lines) != last:
                last = (now.columns, now.lines)
                try:
                    if holder.pty is not None and holder.pty.isalive():
                        holder.pty.setwinsize(now.lines, now.columns)
                    if holder.watcher is not None:
                        holder.watcher.resize(now.columns, now.lines)
                except Exception:
                    pass

    tty.setraw(0)
    spawn(ca.cline_command() + user_args, False)
    for target in (forward_input, follow_size):
        threading.Thread(target=target, daemon=True).start()
    while True:
        time.sleep(1)


if __name__ == "__main__":
    main()
