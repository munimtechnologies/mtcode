# MT Model classifier (optional)

MT Code routes **locally and for $0**, the same way T3 Code does. This worker is **not used** unless someone sets `MT_MODEL_ROUTER_URL`.

If you opt in, keep it on the **Workers Free** plan. Do not enable Workers Paid.

```sh
npx wrangler deploy
```

Then set `MT_MODEL_ROUTER_URL=https://mt-model-router.sheehanmunim.workers.dev` on that machine.
