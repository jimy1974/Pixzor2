document.addEventListener('DOMContentLoaded', () => {
    const buyTokensForm = document.getElementById('buy-tokens-form');
    if (buyTokensForm) {
        buyTokensForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            
            const tokenBundle = document.getElementById('token-bundle');
            const tokens = tokenBundle.value;
            const price = tokenBundle.options[tokenBundle.selectedIndex].dataset.price;

            try {
                const response = await fetch('/payment/create-checkout-session', {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                    },
                    body: JSON.stringify({
                        tokens,
                        price
                    }),
                });

                if (!response.ok) {
                    const errorData = await response.json();
                    throw new Error(errorData.error || 'Payment failed');
                }

                const { sessionId } = await response.json();
                const stripe = Stripe(process.env.STRIPE_PUBLISHABLE_KEY || 'your-publishable-key');
                stripe.redirectToCheckout({ sessionId });
            } catch (error) {
                console.error('Payment error:', error);
                alert('Payment failed: ' + error.message);
            }
        });
    }
});
