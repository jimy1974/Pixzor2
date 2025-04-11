document.querySelector('#upscale-tab #chat-submit').addEventListener('click', () => {
    const input = document.getElementById('upscale-input').value.trim();
    if (input) {
        window.location.href = `/upscale-image?prompt=${encodeURIComponent(input)}`;
    } else {
        alert('Please enter a prompt!');
    }
});