# One container per chat: its own cline-auto + Cline, own state, terminal exposed through ttyd (tmux keeps it alive).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tmux git ca-certificates curl python3 python3-pip \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL --retry 8 --retry-all-errors --retry-delay 3 -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m) \
    && chmod +x /usr/local/bin/ttyd
RUN pip install --break-system-packages pyte
RUN npm install -g cline
RUN useradd -m -s /bin/bash dev && mkdir /workspace && chown dev /workspace

# cline-auto: the user's own scripts (copied into ./cline-tools by start.bat), unchanged except that
# OpenRouter URLs in cline_models.py honour OPENROUTER_BASE so model probing also goes through the Cloudflare Worker.
COPY cline-tools/cline_auto.py cline-tools/cline_models.py cline-tools/cline_log.py /opt/cline-auto/
COPY cline_auto_linux.py /opt/cline-auto/
COPY patch_models.py /tmp/patch_models.py
RUN python3 /tmp/patch_models.py
RUN printf '#!/bin/sh\nexec python3 /opt/cline-auto/cline_auto_linux.py "$@"\n' > /usr/local/bin/cline-auto && chmod +x /usr/local/bin/cline-auto

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER dev
WORKDIR /workspace
ENV TERM=xterm-256color LANG=C.UTF-8 LC_ALL=C.UTF-8 CLINE_AUTO_NO_LOG=1
EXPOSE 7681
ENTRYPOINT ["/entrypoint.sh"]
