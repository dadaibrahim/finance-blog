import type { MiddlewareHandler } from 'astro';

const errorWebhook = 'https://sdi9821.app.n8n.cloud/webhook-test/vercel-error-logs';

export const onRequest: MiddlewareHandler = async (context, next) => {
	try {
		return await next();
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);

		// Only report errors to the webhook if we are not in development mode
		if (!import.meta.env.DEV) {
			Try {
				await fetch(errorWebhook, {
					method: 'POST',
					headers: { 'Content-Type': 'application/json' },
					body: JSON.stringify({
						message,
						request: {
							method: context.request.method,
							url: context.request.url,
						},
						context: {
							route: context.routePattern,
						},
					}),
				});
			} catch {
				// Reporting failures must not replace the original request error.
			}
		}

		throw error;
	}
};