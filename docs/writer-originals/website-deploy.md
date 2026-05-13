# Website Deploy

The marketing website lives in `apps/website/` and deploys to the existing Cloudflare Worker service `writer-website`.

## Configuration

- Worker config: `wrangler.jsonc`
- Worker name: `writer-website`
- Static assets directory: `apps/website/dist`
- Production URL: `https://writer.computer`

The Worker name in Cloudflare must match `name` in `wrangler.jsonc` so local deploys update the intended service.

## Deploy Locally

Deploys are run manually from a local machine using Wrangler CLI. From the repository root:

```sh
vp install
(cd apps/website && vp build)
vp dlx wrangler deploy --config wrangler.jsonc
```

Wrangler must be logged into the Cloudflare account that owns `writer-website`:

```sh
vp dlx wrangler login
```

Verify the deployment:

```sh
curl -I https://writter.computer
```

## Notes

- Do not use GitHub Pages for this website.
- Do not rely on Cloudflare Git Builds for this website unless this document is updated first.
- Keep `wrangler.jsonc` at the repository root so local Wrangler deploys use the same Worker settings.
- Run `vp check` before deploying source changes when practical.
