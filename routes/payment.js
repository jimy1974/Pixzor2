const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { User } = require('../db'); 
const { isAuthenticated } = require('../middleware/authMiddleware'); 

const router = express.Router();

// POST /create-checkout-session
router.post('/create-checkout-session', async (req, res) => {
    if (!req.isAuthenticated()) {
        return res.status(401).json({ error: 'Please log in to purchase tokens.' });
    }

    const { tokens, price } = req.body;
    const userId = req.user.id;

    console.log(`[Checkout] User ${userId} attempting purchase: ${tokens} tokens for £${price}`);

    // Basic validation for price (ensure it's a positive number string)
    const priceValue = parseFloat(price);
    if (isNaN(priceValue) || priceValue <= 0) {
        console.error(`[Checkout] Invalid price received: ${price}`);
        return res.status(400).json({ error: 'Invalid price format.' });
    }

    // Calculate amount in smallest currency unit (pence for GBP)
    // Multiply by 100 and ensure it's an integer
    const amountInPence = Math.round(priceValue * 100);

    // Validate amount is reasonable (optional, e.g., not zero)
    if (amountInPence <= 0) {
        console.error(`[Checkout] Calculated amount in pence is invalid: ${amountInPence}`);
        return res.status(400).json({ error: 'Invalid price amount.' });
    }
    
    // Validate tokens (optional, ensure it's a positive integer string)
    const tokensValue = parseInt(tokens, 10);
    if (isNaN(tokensValue) || tokensValue <= 0) {
        console.error(`[Checkout] Invalid tokens received: ${tokens}`);
        return res.status(400).json({ error: 'Invalid token amount.' });
    }

    try {
        // Create a Stripe Checkout Session using price_data
        const session = await stripe.checkout.sessions.create({
            payment_method_types: ['card'],
            line_items: [
                {
                    price_data: {
                        currency: 'gbp',
                        product_data: {
                            name: `${tokensValue} Tokens`,
                        },
                        unit_amount: amountInPence,
                    },
                    quantity: 1,
                },
            ],
            mode: 'payment',
            success_url: `${req.protocol}://${req.get('host')}/payment/success?session_id={CHECKOUT_SESSION_ID}`,
            cancel_url: `${req.protocol}://${req.get('host')}/payment/cancel`,
            client_reference_id: userId.toString(),
            metadata: { 
                tokens_purchased: tokensValue.toString()
            }
        });

        console.log(`[Checkout] Stripe session created using price_data: ${session.id} for user ${userId}`);
        res.json({ sessionId: session.id });

    } catch (error) {
        console.error(`[Checkout] Stripe session creation failed for user ${userId}:`, error);
        res.status(500).json({ error: 'Could not initiate payment session. Please try again later.' });
    }
});

// GET /success
router.get('/success', async (req, res) => {
    // Check if user is logged in - important for context
    if (!req.isAuthenticated()) {
        console.log('[Payment Success] Unauthenticated user hit success URL. Redirecting to login.');
        return res.redirect('/login?message=Payment+successful,+please+log+in+to+see+updated+tokens.');
    }

    const sessionId = req.query.session_id;
    console.log(`[Payment Success] User ${req.user.id} returned from Stripe. Session ID: ${sessionId}`);

    try {
        // Retrieve the session to get the metadata
        const session = await stripe.checkout.sessions.retrieve(sessionId);
        const tokensPurchased = parseInt(session.metadata.tokens_purchased);
        
        // Update user's credits
        await User.increment('credits', {
            by: parseFloat(tokensPurchased),
            where: { id: req.user.id }
        });

        console.log(`[Payment Success] Updated user ${req.user.id} tokens by ${tokensPurchased}`);
        
        // Redirect with success message
        res.redirect('/?payment=success');
    } catch (error) {
        console.error('[Payment Success] Error updating tokens:', error);
        res.redirect('/?payment=success&error=Failed+to+update+token+count');
    }
});

// GET /cancel
router.get('/cancel', (req, res) => {
    console.log(`[Payment Cancel] User ${req.user ? req.user.id : 'Unknown'} cancelled payment.`);
    res.render('payment/cancel', { title: 'Payment Cancelled', user: req.user });
});

module.exports = router;
