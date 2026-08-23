const axios = require('axios');
const fs = require('fs');

async function test() {
  try {
    const res = await axios.post('http://localhost:5000/api/auth/login', {
      email: 'admin@samratfashion.com',
      password: 'password123'
    });
    
    const cookie = res.headers['set-cookie'];
    console.log('Login success');
    
    try {
      const prodRes = await axios.get('http://localhost:5000/api/admin/products', {
        headers: {
          Cookie: cookie.join('; ')
        }
      });
      console.log('Products:', prodRes.data.data.items.length);
    } catch(err) {
      console.error('Products error:', err.response?.status, err.response?.data);
    }
  } catch (err) {
    console.error('Login error:', err.response?.status, err.response?.data);
  }
}
test();
