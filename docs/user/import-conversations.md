# Import Claude Code and Codex conversations

T3 Code can turn conversations created in the Claude Code or Codex command-line apps into normal
T3 Code threads. Messages, tool calls, tool inputs, and tool results are kept, and the imported
thread can continue through the same provider.

Select **Import conversation** beside **New thread** in the sidebar, or open the command palette and
search for “Import conversation.” Choose the environment that contains the original provider
history, select a conversation and target project, then select **Import**.

On mobile, open **Settings → Import Conversations**, choose the environment and target project, then
tap a conversation to import it.

The source history stays unchanged. T3 Code reads the provider's configured history directory and
stores a separate copy in its own thread history. Importing the same provider conversation again
opens the existing imported thread instead of creating a duplicate.

For remote environments, open the importer for the remote environment: provider history is read on
the machine running that T3 Code server, not from the browser or phone. A conversation only appears
when its provider instance is enabled and its transcript is still present there.

The target project controls the working directory used when the imported thread continues. On the
web and desktop, T3 Code automatically selects the project whose path matches the original
conversation when it can.
