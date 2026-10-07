# One container per chat: its own Cline, its own state, terminal exposed through ttyd (tmux keeps the session alive).
FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends tmux git ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL -o /usr/local/bin/ttyd https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.$(uname -m) && chmod +x /usr/local/bin/ttyd
RUN npm install -g cline
RUN useradd -m -s /bin/bash dev && mkdir /workspace && chown dev /workspace
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh
USER dev
WORKDIR /workspace
ENV TERM=xterm-256color LANG=C.UTF-8 LC_ALL=C.UTF-8
EXPOSE 7681
ENTRYPOINT ["/entrypoint.sh"]
