# Message composer

Messages can contain up to 120,000 characters. If a draft is longer, T3 Code keeps it in the
composer and shows how many characters need to be removed. Shorten the draft or split it into
multiple messages, then send again in the same thread.

On mobile, **Settings → General → Steer active turns** controls messages sent while an agent is
working. Leave it on to steer the active turn immediately. Turn it off to store the message on the
server and run it after the active turn finishes. Server-queued messages remain visible in the
thread and can be cancelled before they start, even if the mobile app disconnects.

If the server restarts during the narrow handoff to a provider, T3 Code reports the delivery as
interrupted instead of replaying it automatically, because the provider may already have received
the message. Check the provider transcript before resending it.

## Edit or revert a message

When an idle thread ends with your message, you can edit that final message. Once the assistant has
replied, Edit is no longer available. Editing changes the wording shown in the conversation and
sends a corrective follow-up.

On web and desktop, Revert remains available on completed turns that have a checkpoint. It returns
both the conversation and workspace to the state before that message.

## Commands and skills

Type `/` to open the command menu. Type `$` to find and add a skill. Skill rows show their source,
such as System, Personal, Project, or App.

By default, the `/` menu includes skills. To keep this menu command-only, turn off **Show skills in
slash menu** in **Settings → General**. Skill results use the `/skill:Skill Name` label and add the
same `$name` skill token to your message. The original skill name remains searchable. If the provider
also reports that skill as a native slash command, T3 Code hides the duplicate native entry and keeps
the `/skill:Skill Name` label.

On desktop, press `Cmd+Enter` on macOS or `Ctrl+Enter` on Windows and Linux from a new thread to
start it in the background. T3 Code opens another new thread and shows an **Open** action for the
thread that started. The new thread keeps the selected workspace mode and base branch. If **New
worktree** is selected, each background thread creates its own worktree.
