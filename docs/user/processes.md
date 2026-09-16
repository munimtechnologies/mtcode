# Processes

The router icon at the left of the chat header's actions opens **Processes**: everything the
agents and terminals of this environment are running right now, grouped by the thread they work
for, with CPU, memory, and running time per process. **Stop** asks a process to end (SIGINT);
**Kill** ends it at once after a confirmation. The list refreshes every two seconds while the
dialog is open.

The list comes from the process monitor the desktop app ships. Against a plain web server the
dialog shows the server's monitor error instead of a list.

Dev servers an agent left running in the background, such as a `pnpm dev` on port 3000, no longer
hang off the agent's process once its shell exits. The dialog still finds them by the port they
listen on and lists them under **Dev servers**, grouped by the thread worktree or project their
working directory falls into, with the port next to the name. Stop and Kill work for them too.
This needs `ps` and `lsof`, so it is macOS and Linux only.
