# Deploying this documentation site

How this repository's documentation site is published to Cloudflare Workers.

The public documentation site is hosted at [zudo-circuit-doc.zudolab.dev](https://zudo-circuit-doc.zudolab.dev) on Cloudflare Workers. The site is built from `doc/` into `doc/dist/` as static files; this deployment does not run a Worker script or server-side rendering.

## Automatic deploys

Every push to `main` starts the production workflow in `.github/workflows/main-deploy.yml`. You can also start it manually with GitHub Actions' **Run workflow** control. The workflow fetches the full Git history because the site builds its document history, builds the workspace packages and site, then deploys the static assets to the custom domain. It checks the homepage, a getting started page, and a missing page after deployment.

## Cloudflare setup

The repository needs these GitHub Actions secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The `zudolab.dev` zone must belong to the Cloudflare account identified by `CLOUDFLARE_ACCOUNT_ID`. The API token needs Workers Scripts: Edit and Workers Routes: Write for the `zudolab.dev` zone; Workers Routes: Write is required when Wrangler adds or updates a route or custom domain. It also needs DNS: Edit access for that zone. Wrangler uses the custom domain declaration in `doc/wrangler.toml` to provision the domain, DNS record, and TLS certificate on deployment.

## Validate locally

After installing the repository dependencies, build and validate the deployment bundle without publishing it:

```sh
pnpm doc:build && npx wrangler@4.85.0 deploy --dry-run --config doc/wrangler.toml
```

The Wrangler version in this command is pinned to match the production workflow. A dry run compiles and validates the site deployment without sending it to Cloudflare.

## Roll back

To restore an earlier deployment, run `wrangler rollback` for the `zudo-circuit-doc` Worker in the configured Cloudflare account. You can also revert or check out the desired earlier commit and let the production workflow deploy that version again.
