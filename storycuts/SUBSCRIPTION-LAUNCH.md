# StoryCuts subscription launch

The product direction is one subscription: the creator records a story, chooses a look, approves the cast and exports. StoryCuts pays the AI providers within each plan's allowance. Customers should not need Claude or OpenAI accounts.

## What this version delivers

- A free, immediately usable sample editor. It uses local licensed footage and existing concept artwork, with a fictional transcript and no recorded voice. It makes no AI requests and grants no subscription access.
- A guided creation flow with recommended video settings and focused character review.
- Preview pricing and an honest plan dialog. Checkout is not available. Viewing a plan takes no payment and saves no entitlement.
- The current advanced preview still accepts a creator's own AI keys, saves them only in their browser and calls the providers directly. While checkout is unconfigured, connected creators can use this preview without the unfinished paywall blocking them.

## What must be connected before charging customers

Keep the GitHub Pages front-end static. Add a separate service for authenticated accounts, subscriptions and company-funded AI. This service must never receive customers' own provider keys; the current browser-only advanced preview remains separate.

1. Sign the creator into an account. The service identifies the account from a verified session, rather than accepting an account ID from the browser.
2. Create Stripe-hosted Checkout sessions for approved subscription prices. Keep Stripe secrets in the service's environment. Return the Checkout URL to the browser.
3. Verify Stripe webhook signatures using the unmodified request body. Process repeated events safely and keep subscription status and allowances in a database.
4. Make the service's account status authoritative. A successful-return URL, localStorage entry or the existing owner-preview switch is not proof of payment. Replace the current preview gate when the paid service launches.
5. Run paid planning and image requests using company-owned provider credentials held only in the service. Authenticate every request, check the allowance and reserve usage before starting work. Track completed work and handle failures and retries without double charging.
6. Keep video playback, speech recognition, editing and export on the creator's device. Only the required transcript, scene instructions and character reference pictures go to the service. Keep generated images locally as today; disclose any service retention before launch.
7. Provide a billing portal for cancellation and plan changes. Update account status after renewal, payment failure, cancellation and allowance changes.

The prices currently shown are preview prices inherited from the repository. Confirm them against real planning, image generation, quality checks, redraws and support costs. Define limits for story length, number of scenes and redraws; don't promise unlimited generation.

## Launch verification

Test the full subscription lifecycle in Stripe test mode: successful payment, declined payment, duplicate webhook, renewal, cancellation and plan change. An unauthenticated or unpaid request must never trigger a company-funded AI call. Changing a browser flag or return URL must not change the service's answer. Concurrent requests must respect the allowance.

Re-run the existing desktop and 390px phone creation and export tests after integrating the service. Preserve all current DOM hooks and the static-site architecture.

## References

This is a launch plan, not a connected billing integration. It follows Stripe's official documentation for [Checkout](https://docs.stripe.com/payments/checkout) and [webhook verification](https://docs.stripe.com/webhooks). No customer accounts, checkout sessions, production prices, secrets or company-funded AI endpoints were created in this design change.
