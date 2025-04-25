// Auth helper functions for protected routes

// Get the stored token
function getAuthToken() {
    return localStorage.getItem('firebaseAuthToken');
  }
  
  // Function to include the token with fetch requests
  async function fetchWithAuth(url, options = {}) {
    const token = getAuthToken();
    
    if (!token) {
      console.error("No auth token found. Please login first.");
      // Redirect to login page
      window.location.href = '/';
      return;
    }
    
    // Set up headers with authorization
    const headers = {
      ...options.headers,
      'Authorization': `Bearer ${token}`
    };
    
    return fetch(url, {
      ...options,
      headers
    });
  }
  
  // Check if user is authenticated
  function checkAuth() {
    const token = getAuthToken();
    if (!token) {
      window.location.href = '/';
      return false;
    }
    return true;
  }
  
  // Example: How to use this for protected routes
  async function makeAuthenticatedRequest(endpoint) {
    try {
      const response = await fetchWithAuth(endpoint);
      if (response.ok) {
        return await response.text();
      } else {
        const errorText = await response.text();
        console.error(`Error from ${endpoint}:`, errorText);
        if (response.status === 401) {
          // Token expired or invalid
          localStorage.removeItem('firebaseAuthToken');
          window.location.href = '/';
        }
        throw new Error(errorText);
      }
    } catch (error) {
      console.error('Request failed:', error);
      throw error;
    }
  }
  
  // Function to logout
  function logout() {
    localStorage.removeItem('firebaseAuthToken');
    window.location.href = '/';
  }