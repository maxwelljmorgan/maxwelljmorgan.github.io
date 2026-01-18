/**
 * Trader Joe's Shopping List Application
 * A mobile web application for managing shopping trips at Trader Joe's
 */

class TJShoppingApp {
    constructor() {
        this.products = [];
        this.categories = [];
        this.cart = [];
        this.currentTrip = null;
        this.shoppingHistory = [];
        this.currentCategory = null;
        this.searchQuery = '';

        // DOM Elements
        this.elements = {};

        this.init();
    }

    async init() {
        this.cacheElements();
        this.bindEvents();
        await this.loadProducts();
        this.loadSavedData();
        this.render();
    }

    cacheElements() {
        // Header
        this.elements.cartBtn = document.getElementById('cartBtn');
        this.elements.cartCount = document.getElementById('cartCount');

        // Navigation
        this.elements.navTabs = document.querySelectorAll('.nav-tab');

        // Tab Contents
        this.elements.shopTab = document.getElementById('shopTab');
        this.elements.cartTab = document.getElementById('cartTab');
        this.elements.historyTab = document.getElementById('historyTab');

        // Shop Tab Elements
        this.elements.tripBanner = document.getElementById('tripBanner');
        this.elements.tripName = document.getElementById('tripName');
        this.elements.endTripBtn = document.getElementById('endTripBtn');
        this.elements.startTripSection = document.getElementById('startTripSection');
        this.elements.startTripBtn = document.getElementById('startTripBtn');
        this.elements.categoryGrid = document.getElementById('categoryGrid');
        this.elements.productList = document.getElementById('productList');
        this.elements.backToCategories = document.getElementById('backToCategories');
        this.elements.categoryTitle = document.getElementById('categoryTitle');
        this.elements.products = document.getElementById('products');
        this.elements.searchSection = document.getElementById('searchSection');
        this.elements.searchInput = document.getElementById('searchInput');
        this.elements.clearSearch = document.getElementById('clearSearch');

        // Cart Tab Elements
        this.elements.emptyCart = document.getElementById('emptyCart');
        this.elements.cartContent = document.getElementById('cartContent');
        this.elements.cartItems = document.getElementById('cartItems');
        this.elements.cartSubtotal = document.getElementById('cartSubtotal');
        this.elements.cartTax = document.getElementById('cartTax');
        this.elements.cartTotal = document.getElementById('cartTotal');

        // History Tab Elements
        this.elements.emptyHistory = document.getElementById('emptyHistory');
        this.elements.historyContent = document.getElementById('historyContent');
        this.elements.historyStats = document.getElementById('historyStats');
        this.elements.historyList = document.getElementById('historyList');

        // Modals
        this.elements.productModal = document.getElementById('productModal');
        this.elements.modalBody = document.getElementById('modalBody');
        this.elements.tripModal = document.getElementById('tripModal');
        this.elements.tripNameInput = document.getElementById('tripNameInput');
        this.elements.tripDate = document.getElementById('tripDate');
        this.elements.cancelTrip = document.getElementById('cancelTrip');
        this.elements.confirmTrip = document.getElementById('confirmTrip');
        this.elements.tripDetailModal = document.getElementById('tripDetailModal');
        this.elements.tripDetailBody = document.getElementById('tripDetailBody');

        // Toast
        this.elements.toast = document.getElementById('toast');
    }

    bindEvents() {
        // Navigation tabs
        this.elements.navTabs.forEach(tab => {
            tab.addEventListener('click', () => this.switchTab(tab.dataset.tab));
        });

        // Cart button
        this.elements.cartBtn.addEventListener('click', () => this.switchTab('cart'));

        // Start trip
        this.elements.startTripBtn.addEventListener('click', () => this.showTripModal());
        this.elements.confirmTrip.addEventListener('click', () => this.startTrip());
        this.elements.cancelTrip.addEventListener('click', () => this.hideTripModal());

        // End trip
        this.elements.endTripBtn.addEventListener('click', () => this.endTrip());

        // Back to categories
        this.elements.backToCategories.addEventListener('click', () => this.showCategories());

        // Search
        this.elements.searchInput.addEventListener('input', (e) => this.handleSearch(e.target.value));
        this.elements.clearSearch.addEventListener('click', () => this.clearSearch());

        // Modal close handlers
        document.querySelectorAll('.modal-overlay, .modal-close').forEach(el => {
            el.addEventListener('click', () => this.closeModals());
        });

        // Prevent modal content clicks from closing
        document.querySelectorAll('.modal-content').forEach(el => {
            el.addEventListener('click', (e) => e.stopPropagation());
        });
    }

    async loadProducts() {
        try {
            // Try to fetch products from the JSON file
            const response = await fetch('products.json');
            const data = await response.json();

            this.products = data.products;
            this.categories = data.categories;

            // Store last update time
            localStorage.setItem('tj_products_last_update', data.lastUpdated);
            localStorage.setItem('tj_products_cache', JSON.stringify(data));

            console.log(`Loaded ${this.products.length} products in ${this.categories.length} categories`);
        } catch (error) {
            console.error('Error loading products:', error);

            // Try to load from cache
            const cached = localStorage.getItem('tj_products_cache');
            if (cached) {
                const data = JSON.parse(cached);
                this.products = data.products;
                this.categories = data.categories;
                console.log('Loaded products from cache');
            } else {
                this.showToast('Error loading products');
            }
        }
    }

    loadSavedData() {
        // Load current trip
        const savedTrip = localStorage.getItem('tj_current_trip');
        if (savedTrip) {
            this.currentTrip = JSON.parse(savedTrip);
        }

        // Load cart
        const savedCart = localStorage.getItem('tj_cart');
        if (savedCart) {
            this.cart = JSON.parse(savedCart);
        }

        // Load shopping history
        const savedHistory = localStorage.getItem('tj_shopping_history');
        if (savedHistory) {
            this.shoppingHistory = JSON.parse(savedHistory);
        }
    }

    saveData() {
        if (this.currentTrip) {
            localStorage.setItem('tj_current_trip', JSON.stringify(this.currentTrip));
        } else {
            localStorage.removeItem('tj_current_trip');
        }

        localStorage.setItem('tj_cart', JSON.stringify(this.cart));
        localStorage.setItem('tj_shopping_history', JSON.stringify(this.shoppingHistory));
    }

    render() {
        this.updateCartCount();
        this.renderCategories();
        this.renderShopTab();
        this.renderCart();
        this.renderHistory();
    }

    switchTab(tabName) {
        // Update nav tabs
        this.elements.navTabs.forEach(tab => {
            tab.classList.toggle('active', tab.dataset.tab === tabName);
        });

        // Update tab content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.classList.remove('active');
        });

        const activeTab = document.getElementById(`${tabName}Tab`);
        if (activeTab) {
            activeTab.classList.add('active');
        }
    }

    // Trip Management
    showTripModal() {
        const now = new Date();
        this.elements.tripDate.textContent = now.toLocaleDateString('en-US', {
            weekday: 'long',
            year: 'numeric',
            month: 'long',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        this.elements.tripNameInput.value = '';
        this.elements.tripModal.classList.remove('hidden');
    }

    hideTripModal() {
        this.elements.tripModal.classList.add('hidden');
    }

    startTrip() {
        const now = new Date();
        const defaultName = `Trip - ${now.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

        this.currentTrip = {
            id: Date.now().toString(),
            name: this.elements.tripNameInput.value.trim() || defaultName,
            startTime: now.toISOString(),
            endTime: null
        };

        this.cart = [];
        this.saveData();
        this.hideTripModal();
        this.renderShopTab();
        this.renderCart();
        this.showToast('Shopping trip started!');
    }

    endTrip() {
        if (!this.currentTrip) return;

        if (this.cart.length > 0) {
            // Calculate totals
            const subtotal = this.calculateSubtotal();
            const tax = subtotal * 0.0825;
            const total = subtotal + tax;

            // Save to history
            const tripRecord = {
                ...this.currentTrip,
                endTime: new Date().toISOString(),
                items: [...this.cart],
                subtotal: subtotal,
                tax: tax,
                total: total
            };

            this.shoppingHistory.unshift(tripRecord);
        }

        this.currentTrip = null;
        this.cart = [];
        this.saveData();
        this.renderShopTab();
        this.renderCart();
        this.renderHistory();
        this.updateCartCount();
        this.showToast('Shopping trip ended');
    }

    // Shop Tab Rendering
    renderShopTab() {
        if (this.currentTrip) {
            this.elements.tripBanner.classList.remove('hidden');
            this.elements.tripName.textContent = this.currentTrip.name;
            this.elements.startTripSection.classList.add('hidden');
            this.elements.searchSection.classList.remove('hidden');

            if (this.currentCategory) {
                this.elements.categoryGrid.classList.add('hidden');
                this.elements.productList.classList.remove('hidden');
            } else {
                this.elements.categoryGrid.classList.remove('hidden');
                this.elements.productList.classList.add('hidden');
            }
        } else {
            this.elements.tripBanner.classList.add('hidden');
            this.elements.startTripSection.classList.remove('hidden');
            this.elements.categoryGrid.classList.add('hidden');
            this.elements.productList.classList.add('hidden');
            this.elements.searchSection.classList.add('hidden');
        }
    }

    renderCategories() {
        this.elements.categoryGrid.innerHTML = this.categories.map(category => `
            <div class="category-card" data-category="${category.id}">
                <div class="category-icon">${category.icon}</div>
                <div class="category-name">${category.name}</div>
            </div>
        `).join('');

        // Bind click events
        this.elements.categoryGrid.querySelectorAll('.category-card').forEach(card => {
            card.addEventListener('click', () => {
                this.showCategory(card.dataset.category);
            });
        });
    }

    showCategories() {
        this.currentCategory = null;
        this.clearSearch();
        this.elements.categoryGrid.classList.remove('hidden');
        this.elements.productList.classList.add('hidden');
    }

    showCategory(categoryId) {
        this.currentCategory = this.categories.find(c => c.id === categoryId);
        if (!this.currentCategory) return;

        this.elements.categoryTitle.innerHTML = `${this.currentCategory.icon} ${this.currentCategory.name}`;
        this.renderProducts();

        this.elements.categoryGrid.classList.add('hidden');
        this.elements.productList.classList.remove('hidden');
    }

    renderProducts() {
        let productsToShow = this.products;

        // Filter by category if selected
        if (this.currentCategory) {
            productsToShow = productsToShow.filter(p => p.category === this.currentCategory.id);
        }

        // Filter by search query
        if (this.searchQuery) {
            const query = this.searchQuery.toLowerCase();
            productsToShow = productsToShow.filter(p =>
                p.name.toLowerCase().includes(query) ||
                p.description.toLowerCase().includes(query) ||
                p.tags.some(t => t.toLowerCase().includes(query))
            );
        }

        this.elements.products.innerHTML = productsToShow.map(product => `
            <div class="product-card" data-product-id="${product.id}">
                <div class="product-info">
                    <div class="product-name">${product.name}</div>
                    <div class="product-unit">${product.unit}</div>
                </div>
                <div class="product-price">$${product.price.toFixed(2)}</div>
            </div>
        `).join('');

        // Bind click events
        this.elements.products.querySelectorAll('.product-card').forEach(card => {
            card.addEventListener('click', () => {
                this.showProductDetail(card.dataset.productId);
            });
        });
    }

    handleSearch(query) {
        this.searchQuery = query;
        this.elements.clearSearch.classList.toggle('hidden', !query);

        if (query && !this.currentCategory) {
            // Show all products matching search
            this.elements.categoryTitle.innerHTML = `Search: "${query}"`;
            this.renderProducts();
            this.elements.categoryGrid.classList.add('hidden');
            this.elements.productList.classList.remove('hidden');
        } else if (query && this.currentCategory) {
            this.renderProducts();
        } else if (!query && !this.currentCategory) {
            this.showCategories();
        } else {
            this.renderProducts();
        }
    }

    clearSearch() {
        this.searchQuery = '';
        this.elements.searchInput.value = '';
        this.elements.clearSearch.classList.add('hidden');

        if (!this.currentCategory) {
            this.showCategories();
        } else {
            this.renderProducts();
        }
    }

    // Product Detail Modal
    showProductDetail(productId) {
        const product = this.products.find(p => p.id === productId);
        if (!product) return;

        const category = this.categories.find(c => c.id === product.category);
        const cartItem = this.cart.find(item => item.productId === productId);
        const quantity = cartItem ? cartItem.quantity : 1;

        this.elements.modalBody.innerHTML = `
            <div class="product-detail-name">${product.name}</div>
            <div class="product-detail-category">${category ? category.icon + ' ' + category.name : ''}</div>
            <div class="product-detail-price">$${product.price.toFixed(2)}</div>
            <div class="product-detail-unit">per ${product.unit}</div>
            <div class="product-detail-description">${product.description}</div>
            <div class="product-tags">
                ${product.tags.map(tag => `<span class="product-tag">${tag}</span>`).join('')}
            </div>
            <div class="quantity-selector" style="display: flex; align-items: center; justify-content: center; gap: 20px; margin-bottom: 20px;">
                <button class="qty-btn minus" id="modalQtyMinus">-</button>
                <span class="qty-value" id="modalQtyValue" style="font-size: 1.5rem;">${quantity}</span>
                <button class="qty-btn plus" id="modalQtyPlus">+</button>
            </div>
            <div class="product-modal-actions">
                <button class="add-to-cart-btn" id="addToCartBtn" ${!this.currentTrip ? 'disabled' : ''}>
                    ${cartItem ? 'Update Cart' : 'Add to Cart'} - $${(product.price * quantity).toFixed(2)}
                </button>
            </div>
            ${!this.currentTrip ? '<p style="text-align: center; color: #666; margin-top: 12px; font-size: 0.875rem;">Start a shopping trip to add items</p>' : ''}
        `;

        let currentQty = quantity;

        // Quantity controls
        const qtyValue = document.getElementById('modalQtyValue');
        const addBtn = document.getElementById('addToCartBtn');

        document.getElementById('modalQtyMinus').addEventListener('click', () => {
            if (currentQty > 1) {
                currentQty--;
                qtyValue.textContent = currentQty;
                addBtn.textContent = `${cartItem ? 'Update Cart' : 'Add to Cart'} - $${(product.price * currentQty).toFixed(2)}`;
            }
        });

        document.getElementById('modalQtyPlus').addEventListener('click', () => {
            currentQty++;
            qtyValue.textContent = currentQty;
            addBtn.textContent = `${cartItem ? 'Update Cart' : 'Add to Cart'} - $${(product.price * currentQty).toFixed(2)}`;
        });

        // Add to cart
        addBtn.addEventListener('click', () => {
            this.addToCart(productId, currentQty);
            this.closeModals();
        });

        this.elements.productModal.classList.remove('hidden');
    }

    // Cart Management
    addToCart(productId, quantity) {
        const product = this.products.find(p => p.id === productId);
        if (!product || !this.currentTrip) return;

        const existingIndex = this.cart.findIndex(item => item.productId === productId);

        if (existingIndex >= 0) {
            this.cart[existingIndex].quantity = quantity;
        } else {
            this.cart.push({
                productId: productId,
                name: product.name,
                unit: product.unit,
                price: product.price,
                quantity: quantity
            });
        }

        this.saveData();
        this.updateCartCount();
        this.renderCart();
        this.showToast(`${product.name} added to cart`);
    }

    updateCartItemQuantity(productId, delta) {
        const itemIndex = this.cart.findIndex(item => item.productId === productId);
        if (itemIndex < 0) return;

        this.cart[itemIndex].quantity += delta;

        if (this.cart[itemIndex].quantity <= 0) {
            this.cart.splice(itemIndex, 1);
        }

        this.saveData();
        this.updateCartCount();
        this.renderCart();
    }

    removeFromCart(productId) {
        const itemIndex = this.cart.findIndex(item => item.productId === productId);
        if (itemIndex >= 0) {
            const itemName = this.cart[itemIndex].name;
            this.cart.splice(itemIndex, 1);
            this.saveData();
            this.updateCartCount();
            this.renderCart();
            this.showToast(`${itemName} removed from cart`);
        }
    }

    calculateSubtotal() {
        return this.cart.reduce((sum, item) => sum + (item.price * item.quantity), 0);
    }

    updateCartCount() {
        const totalItems = this.cart.reduce((sum, item) => sum + item.quantity, 0);
        this.elements.cartCount.textContent = totalItems;
    }

    renderCart() {
        if (this.cart.length === 0) {
            this.elements.emptyCart.classList.remove('hidden');
            this.elements.cartContent.classList.add('hidden');
            return;
        }

        this.elements.emptyCart.classList.add('hidden');
        this.elements.cartContent.classList.remove('hidden');

        this.elements.cartItems.innerHTML = this.cart.map(item => `
            <div class="cart-item" data-product-id="${item.productId}">
                <div class="cart-item-header">
                    <div class="cart-item-info">
                        <div class="cart-item-name">${item.name}</div>
                        <div class="cart-item-unit">${item.unit} - $${item.price.toFixed(2)} each</div>
                    </div>
                    <div class="cart-item-price">$${(item.price * item.quantity).toFixed(2)}</div>
                </div>
                <div class="cart-item-controls">
                    <div class="quantity-controls">
                        <button class="qty-btn minus" data-action="decrease">-</button>
                        <span class="qty-value">${item.quantity}</span>
                        <button class="qty-btn plus" data-action="increase">+</button>
                    </div>
                    <button class="remove-item" data-action="remove">Remove</button>
                </div>
            </div>
        `).join('');

        // Bind events
        this.elements.cartItems.querySelectorAll('.cart-item').forEach(cartItem => {
            const productId = cartItem.dataset.productId;

            cartItem.querySelector('[data-action="decrease"]').addEventListener('click', () => {
                this.updateCartItemQuantity(productId, -1);
            });

            cartItem.querySelector('[data-action="increase"]').addEventListener('click', () => {
                this.updateCartItemQuantity(productId, 1);
            });

            cartItem.querySelector('[data-action="remove"]').addEventListener('click', () => {
                this.removeFromCart(productId);
            });
        });

        // Update totals
        const subtotal = this.calculateSubtotal();
        const tax = subtotal * 0.0825;
        const total = subtotal + tax;

        this.elements.cartSubtotal.textContent = `$${subtotal.toFixed(2)}`;
        this.elements.cartTax.textContent = `$${tax.toFixed(2)}`;
        this.elements.cartTotal.textContent = `$${total.toFixed(2)}`;
    }

    // History Management
    renderHistory() {
        if (this.shoppingHistory.length === 0) {
            this.elements.emptyHistory.classList.remove('hidden');
            this.elements.historyContent.classList.add('hidden');
            return;
        }

        this.elements.emptyHistory.classList.add('hidden');
        this.elements.historyContent.classList.remove('hidden');

        // Calculate stats
        const totalTrips = this.shoppingHistory.length;
        const totalSpent = this.shoppingHistory.reduce((sum, trip) => sum + trip.total, 0);
        const avgSpent = totalSpent / totalTrips;
        const totalItems = this.shoppingHistory.reduce((sum, trip) =>
            sum + trip.items.reduce((itemSum, item) => itemSum + item.quantity, 0), 0
        );

        this.elements.historyStats.innerHTML = `
            <div class="stat-card">
                <div class="stat-value">${totalTrips}</div>
                <div class="stat-label">Total Trips</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">$${totalSpent.toFixed(2)}</div>
                <div class="stat-label">Total Spent</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">$${avgSpent.toFixed(2)}</div>
                <div class="stat-label">Avg per Trip</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">${totalItems}</div>
                <div class="stat-label">Items Bought</div>
            </div>
        `;

        this.elements.historyList.innerHTML = this.shoppingHistory.map(trip => {
            const date = new Date(trip.startTime);
            const itemCount = trip.items.reduce((sum, item) => sum + item.quantity, 0);

            return `
                <div class="history-item" data-trip-id="${trip.id}">
                    <div class="history-item-header">
                        <div class="history-item-name">${trip.name}</div>
                        <div class="history-item-total">$${trip.total.toFixed(2)}</div>
                    </div>
                    <div class="history-item-details">
                        ${date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })} - ${itemCount} item${itemCount !== 1 ? 's' : ''}
                    </div>
                </div>
            `;
        }).join('');

        // Bind click events
        this.elements.historyList.querySelectorAll('.history-item').forEach(item => {
            item.addEventListener('click', () => {
                this.showTripDetail(item.dataset.tripId);
            });
        });
    }

    showTripDetail(tripId) {
        const trip = this.shoppingHistory.find(t => t.id === tripId);
        if (!trip) return;

        const date = new Date(trip.startTime);

        this.elements.tripDetailBody.innerHTML = `
            <div class="trip-detail-header">
                <div class="trip-detail-name">${trip.name}</div>
                <div class="trip-detail-date">${date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' })}</div>
            </div>
            <div class="trip-detail-items">
                ${trip.items.map(item => `
                    <div class="trip-detail-item">
                        <div class="trip-detail-item-name">${item.name}</div>
                        <div class="trip-detail-item-qty">x${item.quantity}</div>
                        <div class="trip-detail-item-price">$${(item.price * item.quantity).toFixed(2)}</div>
                    </div>
                `).join('')}
            </div>
            <div class="trip-detail-total">
                <span>Total</span>
                <span>$${trip.total.toFixed(2)}</span>
            </div>
            <button class="delete-trip-btn" id="deleteTripBtn">Delete Trip</button>
        `;

        document.getElementById('deleteTripBtn').addEventListener('click', () => {
            this.deleteTrip(tripId);
        });

        this.elements.tripDetailModal.classList.remove('hidden');
    }

    deleteTrip(tripId) {
        const index = this.shoppingHistory.findIndex(t => t.id === tripId);
        if (index >= 0) {
            this.shoppingHistory.splice(index, 1);
            this.saveData();
            this.renderHistory();
            this.closeModals();
            this.showToast('Trip deleted');
        }
    }

    // Modals
    closeModals() {
        this.elements.productModal.classList.add('hidden');
        this.elements.tripModal.classList.add('hidden');
        this.elements.tripDetailModal.classList.add('hidden');
    }

    // Toast Notifications
    showToast(message, duration = 2500) {
        this.elements.toast.textContent = message;
        this.elements.toast.classList.remove('hidden');

        setTimeout(() => {
            this.elements.toast.classList.add('hidden');
        }, duration);
    }
}

// Initialize the app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new TJShoppingApp();
});

// Register service worker for PWA support
if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
        navigator.serviceWorker.register('sw.js')
            .then(registration => {
                console.log('ServiceWorker registered:', registration.scope);
            })
            .catch(error => {
                console.log('ServiceWorker registration failed:', error);
            });
    });
}
