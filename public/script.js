document.addEventListener('DOMContentLoaded', function() {
    const profileForm = document.getElementById('profile-form');

    profileForm.addEventListener('submit', async function(event) {
        event.preventDefault(); // Prevent default form submission behavior

        const formData = new FormData(profileForm);
        const username = formData.get('username');
        const bio = formData.get('bio');
        const imageFile = formData.get('profile-image');

        // Prepare data to send to server (you may need to handle image upload differently)
        const data = {
            username: username,
            bio: bio,
            // You may need to handle image upload differently, e.g., using FormData or FileReader
        };

        try {
            const response = await fetch('/api/update-profile', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(data)
            });

            if (!response.ok) {
                throw new Error('Failed to update profile');
            }

            alert('Profile updated successfully!');
        } catch (error) {
            console.error('Error updating profile:', error);
            alert('Failed to update profile. Please try again later.');
        }
    });
});
