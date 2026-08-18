# Messaging between threads

Agents in active threads from the same project can coordinate through built-in tools:

- `thread_list` returns active sibling threads with their stable T3 thread ID, title, status, branch,
  and workspace kind.
- `thread_send` delivers a message to one of those thread IDs and starts or queues a turn there.
- `thread_create` starts a new sibling thread in the same project and begins its first turn with the
  supplied message.
- `thread_archive` retires a finished sibling thread from the active list.

T3 records the message and turn request before it starts, resumes, or steers the recipient's provider
session. The recipient sees a server-authored source thread title and ID, so message text cannot forge
the sender's identity.

Thread messages do not share provider conversation context or expose another thread's transcript.
They also do not wait for the recipient or merge worktrees. Include the context the recipient needs
in the message, and use the source thread ID in the attribution if a reply is useful. To let an agent
read another thread's transcript, reference that thread with `#` in the composer instead; the agent
can then fetch it with the read-only `thread_read` tool.

Delivery is limited to active sibling threads in the same project. A thread cannot message itself.
`thread_send` returning `accepted` means T3 durably accepted the target turn; it does not mean the
recipient finished the work.

## Agent-created threads

A thread created with `thread_create` inherits the creating thread's provider, model, and workspace,
appears in the sidebar like any other thread, and runs independently. Its first message carries the
same server-authored attribution as a thread message, so the new thread knows which sibling created
it and can report back with `thread_send`. If no title is supplied, T3 names the thread from the
first message.

Creation is refused while the project already has many threads actively working, which keeps a
runaway agent from multiplying threads. `thread_archive` refuses targets that are working or waiting
on you, and a thread can never archive itself. Archived threads can be restored from the sidebar at
any time.
