const express = require('express');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { User } = require('../db'); // Assuming db exports User

const router = express.Router();

// Stripe Webhook Handler
// IMPORTANT: This needs the raw body, so it must be mounted BEFORE express.json() in server.js
router.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

    console.log('[Webhook Route] Received event.');

    if (!webhookSecret) {
        console.error('[Webhook Route] Error: STRIPE_WEBHOOK_SECRET is not set.');
        return res.status(500).send('Webhook configuration error.');
    }
    
    if (!sig) {
        console.error('[Webhook Route] Error: Missing stripe-signature header.');
        return res.status(400).send('Missing signature header.');
    }

    if (!req.body || req.body.length === 0) {
        console.log('[Webhook Route] Raw body is missing or empty.');
        return res.status(400).send('Missing or empty request body.');
    }

    let event;
    try {
        event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
        console.log('[Webhook Route] Event verified:', event.type, 'ID:', event.id);
    } catch (err) {
        console.error(`[Webhook Route] Signature verification failed: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the checkout.session.completed event
    if (event.type === 'checkout.session.completed') {
        const session = event.data.object;
        
        const userIdString = session.client_reference_id;
        const tokensPurchasedString = session.metadata.tokens_purchased;

        console.log('[Webhook Route] Processing checkout.session.completed:', {
            sessionId: session.id,
            client_reference_id: userIdString,
            metadata_tokens_purchased: tokensPurchasedString,
            payment_status: session.payment_status
        });

        if (session.payment_status !== 'paid') {
             console.log(`[Webhook Route] Ignoring session ${session.id}, payment status is ${session.payment_status}`);
             return res.status(200).json({ received: true, message: 'Session not paid' });
        }

        if (!userIdString || !tokensPurchasedString) {
            console.error(`[Webhook Route] Error: Missing client_reference_id (${userIdString}) or metadata.tokens_purchased (${tokensPurchasedString}) in session ${session.id}`);
            return res.status(400).json({ error: 'Missing required session data.' });
        }
        
        const userId = parseInt(userIdString, 10);
        const tokensToAdd = parseInt(tokensPurchasedString, 10);

        if (isNaN(userId) || isNaN(tokensToAdd) || tokensToAdd <= 0) {
            console.error(`[Webhook Route] Error: Invalid userId (${userIdString} -> ${userId}) or tokensToAdd (${tokensPurchasedString} -> ${tokensToAdd}) in session ${session.id}`);
            return res.status(400).json({ error: 'Invalid user ID or token amount.' });
        }

        try {
            const user = await User.findByPk(userId);
            if (user) {
                const currentTokens = parseFloat(user.tokens) || 0;
                const newTotal = currentTokens + tokensToAdd;
                await user.update({ tokens: newTotal });
                console.log(`[Webhook Route] SUCCESS: Added ${tokensToAdd} tokens to user ${userId}. New total: ${newTotal}.`);
                return res.status(200).json({ received: true, message: 'Tokens updated.' });
            } else {
                console.error(`[Webhook Route] Error: User ${userId} not found for session ${session.id}`);
                return res.status(400).json({ error: 'User not found.' });
            }
        } catch (dbError) {
            console.error(`[Webhook Route] DB Error updating tokens for user ${userId} (Session ${session.id}):`, dbError);
            return res.status(500).json({ error: 'Failed to update tokens due to server error.' });
        }
    } else {
        console.log(`[Webhook Route] Received unhandled event type: ${event.type}`);
    }

    res.status(200).json({ received: true, message: 'Event received but not processed.' });
});

module.exports = router;
