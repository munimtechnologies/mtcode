# Sending work to another computer

Agents can start a new thread on another computer this MT Code client already knows about:

- `computer_list` returns this machine plus SSH hosts, T3 Connect environments, and other paired
  backends, with ids, labels, OS, connection kind, and whether each one is reachable.
- `computer_send` starts a new thread on one of those computers with the given task.

The current chat is not moved and its transcript is not shared. Include everything the recipient
needs in `message`. Use `computer` set to an environment id, label, SSH `user@host`, or `this`.

Same-machine sends are handled on that computer's server. Cross-machine sends are brokered by the
desktop, web, or mobile app, which is authenticated to both backends. Keep the app open so it can
complete the hop. Offline SSH hosts are woken the same way as when you pick them in **Run on**.

`computer_send` returning a thread id means MT Code accepted the new thread on the target computer;
it does not mean that agent finished the work.
