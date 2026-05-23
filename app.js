/* ==========================================================================
   NovaSpend Application Logic
   State Management, UI Renderer, Chart Integrator, and Supabase Sync API
   ========================================================================== */

// --- Constants & Color Configs ---
const CATEGORY_COLORS = {
    'Food': '#3b82f6',              // Indigo/Blue
    'Transport': '#f59e0b',         // Amber
    'Shopping': '#ec4899',          // Pink/Rose
    'Utilities': '#10b981',         // Emerald Green
    'Entertainment': '#a855f7',     // Purple
    'Paying to someone': '#f43f5e', // Coral Red
    'Other': '#6b7280'              // Gray
};

// --- Supabase Background Credentials ---
const SUPABASE_URL = 'https://axillvetqfnoikrzgdjt.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImF4aWxsdmV0cWZub2lrcnpnZGp0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzEwMDgxNTQsImV4cCI6MjA4NjU4NDE1NH0.L4S8RqVksY8uRuQy_E6ANpuzq5cjFz_Grm8mNte9FGI';

// --- Application State ---
let state = {
    currencyCode: 'INR',
    expenses: [],
    deposits: [],
    plannedItems: [],
    needRemoteInit: false,
    supabaseConfig: {
        mode: 'supabase'
    },
    userSession: null,
    sharedOwnerId: null       // Set when logged-in user is a shared member of another account
};

// --- Currency Formatting Utility ---
function formatCurrency(val) {
    const currencyCode = state.currencyCode || 'INR';
    return new Intl.NumberFormat('en-GB', { style: 'currency', currency: currencyCode }).format(val);
}

// --- Mock Initial Data (Used only on the very first load if both storages are empty) ---
const mockInitialData = {
    deposits: [],
    expenses: []
};

// --- Global Chart Instances ---
let categoryChartInstance = null;
let trendChartInstance = null;

// --- Initialize App ---
document.addEventListener('DOMContentLoaded', () => {
    initDateDisplay();
    loadAuthSession();
    loadSupabaseConfig();
    checkAuthRouting();
    
    // Attempt to load data from configured storage
    if (state.supabaseConfig.mode === 'supabase') {
        if (state.userSession) {
            updateSyncStatus('syncing', 'Syncing with Supabase...');
            pullDataFromSupabase()
                .then(success => {
                    if (success) {
                        showToast('Data synced with Supabase!', 'success');
                    } else {
                        // Fallback to local
                        loadLocalData();
                        showToast('Failed to pull from Supabase. Using offline data.', 'warning');
                    }
                    renderDashboard();
                })
                .catch(err => {
                    loadLocalData();
                    renderDashboard();
                });
        } else {
            loadLocalData();
            renderDashboard();
        }
    } else {
        loadLocalData();
        renderDashboard();
    }

    setupEventListeners();
    setupModals();
});

// --- Date helper ---
function initDateDisplay() {
    const headerDate = document.getElementById('header-date');
    const options = { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' };
    headerDate.textContent = new Date().toLocaleDateString('en-US', options);
    
    // Set default dates in forms to today
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('cash-date').value = today;
    document.getElementById('expense-date').value = today;
}

// --- Data Loading and Merging ---
function loadLocalData() {
    const localData = localStorage.getItem('novaspend_v2_data');
    if (localData) {
        try {
            const parsed = JSON.parse(localData);
            state.expenses = parsed.expenses || [];
            state.deposits = parsed.deposits || [];
            state.plannedItems = parsed.plannedItems || [];
            state.currencyCode = parsed.currencyCode || 'INR';
        } catch (e) {
            console.error('Failed to parse local storage data', e);
            loadMockData();
        }
    } else {
        loadMockData();
    }
}

function loadMockData() {
    state.expenses = [...mockInitialData.expenses];
    state.deposits = [...mockInitialData.deposits];
    state.plannedItems = [];
    saveLocalData();
}

function saveLocalData() {
    localStorage.setItem('novaspend_v2_data', JSON.stringify({
        currencyCode: state.currencyCode || 'INR',
        expenses: state.expenses,
        deposits: state.deposits,
        plannedItems: state.plannedItems
    }));
}

// --- Authentication State Helpers ---
function loadAuthSession() {
    const session = localStorage.getItem('novaspend_auth_session');
    if (session) {
        try {
            state.userSession = JSON.parse(session);
            // Restore shared account state if previously detected
            if (state.userSession && state.userSession.sharedOwnerId) {
                state.sharedOwnerId = state.userSession.sharedOwnerId;
            }
        } catch (e) {
            console.error('Failed to parse auth session', e);
        }
    }
}

function saveAuthSession(sessionData) {
    state.userSession = sessionData;
    localStorage.setItem('novaspend_auth_session', JSON.stringify(sessionData));
}

function clearAuthSession() {
    state.userSession = null;
    state.sharedOwnerId = null;
    localStorage.removeItem('novaspend_auth_session');
}

// Returns the effective user_id to use for DB operations.
// If logged in as a shared member, use the owner's ID so data stays in the correct account.
function getEffectiveUserId() {
    return state.sharedOwnerId || (state.userSession ? state.userSession.id : null);
}

function checkAuthRouting() {
    const authScreen = document.getElementById('auth-screen');
    const profileEl = document.getElementById('user-profile');
    const emailDisplay = document.getElementById('user-email-display');
    const sharedBanner = document.getElementById('shared-account-banner');

    if (state.supabaseConfig.mode === 'supabase' && !state.userSession) {
        if (authScreen) authScreen.style.display = 'flex';
        if (profileEl) profileEl.style.display = 'none';
        if (sharedBanner) sharedBanner.style.display = 'none';
    } else {
        if (authScreen) authScreen.style.display = 'none';
        
        if (state.supabaseConfig.mode === 'supabase' && state.userSession) {
            if (profileEl) profileEl.style.display = 'flex';
            if (emailDisplay) emailDisplay.textContent = state.userSession.email;

            // Show shared account banner if viewing another account
            if (sharedBanner) {
                if (state.sharedOwnerId) {
                    sharedBanner.style.display = 'flex';
                    const ownerLabel = document.getElementById('shared-owner-label');
                    if (ownerLabel) ownerLabel.textContent = state.userSession.sharedOwnerEmail || 'shared account';
                } else {
                    sharedBanner.style.display = 'none';
                }
            }
        } else {
            if (profileEl) profileEl.style.display = 'none';
        }
    }
}

function loadSupabaseConfig() {
    const mode = localStorage.getItem('novaspend_v2_sb_mode') || 'supabase';
    state.supabaseConfig.mode = mode;
    
    const syncModeEl = document.getElementById('sync-mode');
    if (syncModeEl) syncModeEl.value = mode;
    
    toggleSupabaseConfigVisibility(mode);
}

function saveSupabaseConfig() {
    localStorage.setItem('novaspend_v2_sb_mode', state.supabaseConfig.mode);
}

function isSupabaseConfigValid() {
    return true; // Background credentials are always valid
}

function updateEventFilters() {
    const filterSelect = document.getElementById('filter-event');
    const datalist = document.getElementById('events-list');
    if (!filterSelect || !datalist) return;

    // Get all unique non-empty events
    const eventsSet = new Set();
    state.expenses.forEach(e => { if (e.event) eventsSet.add(e.event); });
    state.deposits.forEach(d => { if (d.event) eventsSet.add(d.event); });
    const sortedEvents = Array.from(eventsSet).sort();

    // Save current filter selection
    const currentFilterVal = filterSelect.value;

    // Update datalist suggestions
    datalist.innerHTML = sortedEvents.map(ev => `<option value="${ev}">`).join('');

    // Update select dropdown options
    filterSelect.innerHTML = `
        <option value="all">All Events</option>
        ${sortedEvents.map(ev => `<option value="${ev}">${ev}</option>`).join('')}
    `;

    // Restore selected value if valid, else default to 'all'
    if (eventsSet.has(currentFilterVal)) {
        filterSelect.value = currentFilterVal;
    } else {
        filterSelect.value = 'all';
    }
}

// --- UI Rendering Engines ---
function renderDashboard() {
    updateEventFilters();
    calculateAndRenderMetrics();
    renderCategoryBreakdown();
    renderCharts();
    renderLedger();
    renderPlannedSection();
}

function calculateAndRenderMetrics() {
    const activeEventFilter = document.getElementById('filter-event') ? document.getElementById('filter-event').value : 'all';
    const filteredExpenses = activeEventFilter === 'all' 
        ? state.expenses 
        : state.expenses.filter(e => e.event === activeEventFilter);
    const filteredDeposits = activeEventFilter === 'all' 
        ? state.deposits 
        : state.deposits.filter(d => d.event === activeEventFilter);

    // Total income/deposits (Cash additions)
    const depositsTotal = filteredDeposits.reduce((acc, curr) => acc + Number(curr.amount), 0);
    
    // Total expenses (Total cost of all logged items)
    const expensesTotal = filteredExpenses.reduce((acc, curr) => acc + Number(curr.amount), 0);
    
    // Deposits Paid (Outflow paid towards expenses)
    const depositsPaid = filteredExpenses.reduce((acc, curr) => {
        if (curr.amountPaid !== undefined) {
            return acc + Number(curr.amountPaid);
        }
        // Backward compatibility fallback
        return acc + Number(curr.status === 'paid' ? curr.amount : 0);
    }, 0);
        
    // Outstanding balance (Remaining unpaid balance)
    const outstandingTotal = filteredExpenses.reduce((acc, curr) => {
        if (curr.amountPaid !== undefined) {
            return acc + (Number(curr.amount) - Number(curr.amountPaid));
        }
        // Backward compatibility fallback
        return acc + (curr.status === 'outstanding' ? Number(curr.amount) : 0);
    }, 0);
        
    // Cash in hand = Total Inflow - Deposits Paid
    const cashInHand = depositsTotal - depositsPaid;

    // DOM Updates
    document.getElementById('val-cash-hand').textContent = formatCurrency(cashInHand);
    document.getElementById('val-expenses-total').textContent = formatCurrency(expensesTotal);
    document.getElementById('val-deposits-total').textContent = formatCurrency(depositsPaid);
    document.getElementById('val-outstanding-total').textContent = formatCurrency(outstandingTotal);
    
    // Income text footer
    document.getElementById('val-income-total').textContent = `Total Cash Added: ${formatCurrency(depositsTotal)}`;
    
    // Count footers
    document.getElementById('val-expenses-count').textContent = `${filteredExpenses.length} recorded items`;
    
    const paidCount = filteredExpenses.filter(e => e.amountPaid > 0).length;
    document.getElementById('val-deposits-count').textContent = `${paidCount} items paid`;
    
    const outstandingCount = filteredExpenses.filter(e => Number(e.amount) - Number(e.amountPaid || 0) > 0).length;
    document.getElementById('val-outstanding-count').textContent = `${outstandingCount} items pending`;

    // Planned budget card
    const plannedTotal = state.plannedItems.reduce((sum, p) => sum + Number(p.estimatedAmount), 0);
    document.getElementById('val-planned-total').textContent = formatCurrency(plannedTotal);
    document.getElementById('val-planned-count').textContent = `${state.plannedItems.length} planned item${state.plannedItems.length !== 1 ? 's' : ''}`;
}

function renderCategoryBreakdown() {
    const listContainer = document.getElementById('category-progress-list');
    listContainer.innerHTML = '';
    
    const activeEventFilter = document.getElementById('filter-event') ? document.getElementById('filter-event').value : 'all';
    const filteredExpenses = activeEventFilter === 'all' 
        ? state.expenses 
        : state.expenses.filter(e => e.event === activeEventFilter);
    
    if (filteredExpenses.length === 0) {
        listContainer.innerHTML = `<div class="no-data-msg">No transactions registered yet.</div>`;
        return;
    }

    // Get total expense amount
    const totalExpenses = filteredExpenses.reduce((sum, item) => sum + Number(item.amount), 0);
    
    // Sum amounts by category
    const categorySums = {};
    filteredExpenses.forEach(exp => {
        categorySums[exp.category] = (categorySums[exp.category] || 0) + Number(exp.amount);
    });

    // Sort categories by spending amount descending
    const sortedCategories = Object.entries(categorySums).sort((a, b) => b[1] - a[1]);

    sortedCategories.forEach(([category, amount]) => {
        const percentage = totalExpenses > 0 ? ((amount / totalExpenses) * 100).toFixed(0) : 0;
        const color = CATEGORY_COLORS[category] || '#6b7280';
        
        const catItem = document.createElement('div');
        catItem.className = 'category-bar-item';
        catItem.innerHTML = `
            <div class="category-info">
                <span class="cat-name">
                    <span class="cat-dot" style="background-color: ${color}"></span>
                    ${category}
                </span>
                <span class="cat-amount">${formatCurrency(amount)} (${percentage}%)</span>
            </div>
            <div class="progress-track">
                <div class="progress-bar" style="background-color: ${color}; width: ${percentage}%"></div>
            </div>
        `;
        listContainer.appendChild(catItem);
    });
}

function renderCharts() {
    // 1. Category Donut Chart
    const ctxCat = document.getElementById('categoryChart').getContext('2d');
    
    const activeEventFilter = document.getElementById('filter-event') ? document.getElementById('filter-event').value : 'all';
    const filteredExpenses = activeEventFilter === 'all' 
        ? state.expenses 
        : state.expenses.filter(e => e.event === activeEventFilter);
    const filteredDeposits = activeEventFilter === 'all' 
        ? state.deposits 
        : state.deposits.filter(d => d.event === activeEventFilter);
        
    // Process categories
    const categorySums = {};
    filteredExpenses.forEach(exp => {
        categorySums[exp.category] = (categorySums[exp.category] || 0) + Number(exp.amount);
    });
    
    const categories = Object.keys(categorySums);
    const amounts = Object.values(categorySums);
    const backgroundColors = categories.map(cat => CATEGORY_COLORS[cat] || '#6b7280');
    
    if (categoryChartInstance) {
        categoryChartInstance.destroy();
    }
    
    if (categories.length === 0) {
        // Draw empty indicator state
        categoryChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: ['No Data'],
                datasets: [{
                    data: [1],
                    backgroundColor: ['rgba(0, 0, 0, 0.05)'],
                    borderWidth: 0
                }]
            },
            options: {
                cutout: '75%',
                plugins: {
                    legend: { display: false },
                    tooltip: { enabled: false }
                }
            }
        });
    } else {
        categoryChartInstance = new Chart(ctxCat, {
            type: 'doughnut',
            data: {
                labels: categories,
                datasets: [{
                    data: amounts,
                    backgroundColor: backgroundColors,
                    borderWidth: 1,
                    borderColor: 'rgba(0, 0, 0, 0.05)',
                    hoverOffset: 6
                }]
            },
            options: {
                cutout: '70%',
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom',
                        labels: {
                            color: '#475569',
                            font: { family: 'Plus Jakarta Sans', size: 11 },
                            padding: 15,
                            usePointStyle: true,
                            pointStyle: 'circle'
                        }
                    },
                    tooltip: {
                        backgroundColor: '#ffffff',
                        titleColor: '#0f172a',
                        bodyColor: '#475569',
                        borderColor: 'rgba(0, 0, 0, 0.08)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: function(context) {
                                let label = context.label || '';
                                if (label) {
                                    label += ': ';
                                }
                                if (context.parsed !== null) {
                                    label += formatCurrency(context.parsed);
                                }
                                return label;
                            }
                        }
                    }
                }
            }
        });
    }

    // 2. Trend Line Chart (Deposits vs Expenses over time/months)
    const ctxTrend = document.getElementById('trendChart').getContext('2d');
    
    // Sort and compile monthly totals (all dates formatted YYYY-MM)
    const monthlyData = {};
    
    filteredDeposits.forEach(dep => {
        const month = dep.date.substring(0, 7); // "YYYY-MM"
        if (!monthlyData[month]) monthlyData[month] = { expenses: 0, deposits: 0 };
        monthlyData[month].deposits += Number(dep.amount);
    });
    
    filteredExpenses.forEach(exp => {
        const month = exp.date.substring(0, 7); // "YYYY-MM"
        if (!monthlyData[month]) monthlyData[month] = { expenses: 0, deposits: 0 };
        monthlyData[month].expenses += Number(exp.amount);
    });
    
    // Sort months chronologically
    const sortedMonths = Object.keys(monthlyData).sort();
    const depositsTrend = sortedMonths.map(m => monthlyData[m].deposits);
    const expensesTrend = sortedMonths.map(m => monthlyData[m].expenses);
    
    // Format months display ("May 2026")
    const monthLabels = sortedMonths.map(m => {
        const [year, month] = m.split('-');
        const dateObj = new Date(year, month - 1);
        return dateObj.toLocaleDateString('en-GB', { month: 'short', year: '2-digit' });
    });
    
    if (trendChartInstance) {
        trendChartInstance.destroy();
    }
    
    trendChartInstance = new Chart(ctxTrend, {
        type: 'line',
        data: {
            labels: monthLabels.length ? monthLabels : ['Empty'],
            datasets: [
                {
                    label: 'Cash Inflow (Deposits)',
                    data: depositsTrend.length ? depositsTrend : [0],
                    borderColor: '#10b981',
                    backgroundColor: 'rgba(16, 185, 129, 0.05)',
                    tension: 0.35,
                    fill: true,
                    borderWidth: 2,
                    pointBackgroundColor: '#10b981'
                },
                {
                    label: 'Outflow (Expenses)',
                    data: expensesTrend.length ? expensesTrend : [0],
                    borderColor: '#f43f5e',
                    backgroundColor: 'rgba(244, 63, 94, 0.05)',
                    tension: 0.35,
                    fill: true,
                    borderWidth: 2,
                    pointBackgroundColor: '#f43f5e'
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                x: {
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    ticks: { color: '#475569', font: { family: 'Plus Jakarta Sans', size: 10 } }
                },
                y: {
                    grid: { color: 'rgba(0, 0, 0, 0.04)' },
                    ticks: { color: '#475569', font: { family: 'Plus Jakarta Sans', size: 10 } }
                }
            },
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        color: '#475569',
                        font: { family: 'Plus Jakarta Sans', size: 11 },
                        usePointStyle: true,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: '#ffffff',
                    titleColor: '#0f172a',
                    bodyColor: '#475569',
                    borderColor: 'rgba(0, 0, 0, 0.08)',
                    borderWidth: 1,
                    padding: 10
                }
            }
        }
    });
}

function renderLedger() {
    const tableBody = document.getElementById('ledger-body');
    tableBody.innerHTML = '';
    
    // Combine lists, adding descriptive fields for unified timeline sorting
    const unifiedList = [
        ...state.deposits.map(d => ({
            ...d,
            unifiedType: 'deposit',
            category: 'Deposit',
            payee: d.source,
            status: 'paid',
            event: d.event || '',
            amountPaid: d.amount
        })),
        ...state.expenses.map(e => {
            const amtPaid = e.amountPaid !== undefined ? Number(e.amountPaid) : (e.status === 'paid' ? Number(e.amount) : 0);
            let itemStatus = 'unpaid';
            if (amtPaid === Number(e.amount)) {
                itemStatus = 'paid';
            } else if (amtPaid > 0) {
                itemStatus = 'partial';
            }
            
            return {
                ...e,
                unifiedType: 'expense',
                event: e.event || '',
                amountPaid: amtPaid,
                status: itemStatus
            };
        })
    ];
    
    // Sort transactions by date descending, then ID descending
    unifiedList.sort((a, b) => {
        const dateCompare = b.date.localeCompare(a.date);
        if (dateCompare !== 0) return dateCompare;
        return b.id.localeCompare(a.id);
    });

    // Get filter selections
    const filterCategory = document.getElementById('filter-category').value;
    const filterStatus = document.getElementById('filter-status').value;
    const filterEvent = document.getElementById('filter-event') ? document.getElementById('filter-event').value : 'all';
    const searchVal = document.getElementById('ledger-search').value.toLowerCase().trim();

    // Apply filtering
    const filteredList = unifiedList.filter(item => {
        // Category filter
        if (filterCategory !== 'all' && item.category !== filterCategory) {
            return false;
        }
        // Event filter
        if (filterEvent !== 'all' && item.event !== filterEvent) {
            return false;
        }
        // Status filter
        if (filterStatus !== 'all') {
            if (filterStatus === 'paid' && item.status !== 'paid') return false;
            if (filterStatus === 'partial' && item.status !== 'partial') return false;
            if (filterStatus === 'unpaid' && item.status !== 'unpaid') return false;
        }
        // Search text (payee name or notes)
        if (searchVal) {
            const payeeMatch = item.payee ? item.payee.toLowerCase().includes(searchVal) : false;
            const notesMatch = item.notes ? item.notes.toLowerCase().includes(searchVal) : false;
            if (!payeeMatch && !notesMatch) return false;
        }
        return true;
    });

    if (filteredList.length === 0) {
        tableBody.innerHTML = `
            <tr class="ledger-empty-row">
                <td colspan="7" class="text-center" style="color: var(--text-muted); padding: 3rem 0;">
                    <i class="fa-solid fa-folder-open" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block; opacity: 0.6;"></i>
                    No transactions match the selected filters.
                </td>
            </tr>
        `;
        return;
    }

    filteredList.forEach(item => {
        const tr = document.createElement('tr');
        
        // Icon type
        const typeIcon = item.unifiedType === 'deposit' 
            ? '<i class="fa-solid fa-arrow-down-long" style="color: var(--color-emerald)"></i>' 
            : '<i class="fa-solid fa-arrow-up-long" style="color: var(--color-rose)"></i>';
            
        // Initial for Avatar
        const avatarInitial = item.payee ? item.payee.trim().substring(0, 2).toUpperCase() : '??';
        
        // Amount styling
        let amountClass = 'amount-expense';
        let amountPrefix = '-';
        let amountHTML = '';
        
        if (item.category === 'Deposit') {
            amountClass = 'amount-deposit';
            amountPrefix = '+';
            amountHTML = `${amountPrefix}${formatCurrency(Number(item.amount))}`;
        } else {
            if (item.status === 'paid') {
                amountClass = 'amount-expense';
                amountHTML = `${amountPrefix}${formatCurrency(Number(item.amount))}`;
            } else if (item.status === 'partial') {
                amountClass = 'amount-outstanding';
                amountHTML = `
                    <span style="font-weight: 700;">${amountPrefix}${formatCurrency(Number(item.amount))}</span>
                    <span class="payee-notes" style="margin-top: 0.15rem; font-size: 0.72rem; color: var(--text-secondary);">Paid: ${formatCurrency(item.amountPaid)} | Owe: ${formatCurrency(Number(item.amount) - item.amountPaid)}</span>
                `;
            } else { // unpaid
                amountClass = 'amount-outstanding';
                amountHTML = `${amountPrefix}${formatCurrency(Number(item.amount))}`;
            }
        }
        
        // Badges
        let statusBadge = '';
        if (item.category === 'Deposit') {
            statusBadge = '<span class="badge badge-deposit"><i class="fa-solid fa-circle-down"></i> Received</span>';
        } else if (item.status === 'paid') {
            statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Paid</span>';
        } else if (item.status === 'partial') {
            statusBadge = '<span class="badge badge-outstanding" style="background-color: rgba(245, 158, 11, 0.08); color: #92400e; border: 1px solid rgba(245, 158, 11, 0.15);"><i class="fa-solid fa-circle-minus"></i> Partial</span>';
        } else {
            statusBadge = '<span class="badge badge-outstanding"><i class="fa-solid fa-circle-dot"></i> Unpaid</span>';
        }

        const categoryBadge = `<span class="badge-cat" style="border-left: 3px solid ${CATEGORY_COLORS[item.category] || 'var(--color-primary)'}">${item.category}</span>`;
        
        tr.innerHTML = `
            <td>
                <div style="display: flex; align-items: center; gap: 0.75rem;">
                    ${typeIcon}
                    <span style="text-transform: capitalize; font-weight: 500;">${item.unifiedType === 'deposit' ? 'Inflow' : 'Outflow'}</span>
                </div>
            </td>
            <td>${categoryBadge}</td>
            <td>
                <div class="payee-cell">
                    <div class="payee-avatar">${avatarInitial}</div>
                    <div>
                        <span class="payee-name">${item.payee || 'Unknown'}</span>
                        ${item.event ? `<span class="payee-event-tag"><i class="fa-solid fa-tag"></i> ${item.event}</span>` : ''}
                        ${item.notes ? `<span class="payee-notes">${item.notes}</span>` : ''}
                    </div>
                </div>
            </td>
            <td style="color: var(--text-secondary); font-size: 0.85rem;">
                ${formatDate(item.date)}
            </td>
            <td>
                ${item.category !== 'Deposit' ? `
                    <div style="cursor: pointer;" onclick="toggleExpenseStatus('${item.id}')" title="Click to toggle Paid/Outstanding">
                        ${statusBadge}
                    </div>
                ` : statusBadge}
            </td>
            <td class="text-right amount-cell ${amountClass}">
                ${amountHTML}
            </td>
            <td class="text-center" style="white-space: nowrap;">
                ${item.unifiedType === 'expense' ? `
                    <button class="btn-action-edit" onclick="toggleExpenseStatus('${item.id}')" title="Update Payment/Deposit Amount">
                        <i class="fa-solid fa-pen-to-square"></i>
                    </button>
                ` : ''}
                <button class="btn-action-delete" onclick="deleteTransaction('${item.id}', '${item.category === 'Deposit' ? 'deposit' : 'expense'}')" title="Delete Transaction">
                    <i class="fa-solid fa-trash-can"></i>
                </button>
            </td>
        `;
        tableBody.appendChild(tr);
    });
}

function formatDate(dateStr) {
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

// --- Planned Section Renderer ---
function renderPlannedSection() {
    const tbody = document.getElementById('planned-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (state.plannedItems.length === 0) {
        tbody.innerHTML = `
            <tr class="planned-empty-row">
                <td colspan="7" class="text-center" style="color: var(--text-muted); padding: 3rem 0;">
                    <i class="fa-solid fa-calendar-plus" style="font-size: 1.8rem; margin-bottom: 0.5rem; display: block; opacity: 0.6; color: var(--color-saffron);"></i>
                    No planned costs yet. Click "Plan Cost" to add items you need to pay soon.
                </td>
            </tr>`;
        return;
    }

    // Sort by target date ascending (undated last)
    const sorted = [...state.plannedItems].sort((a, b) => {
        if (!a.targetDate && !b.targetDate) return 0;
        if (!a.targetDate) return 1;
        if (!b.targetDate) return -1;
        return a.targetDate.localeCompare(b.targetDate);
    });

    sorted.forEach(item => {
        const tr = document.createElement('tr');
        tr.dataset.id = item.id;

        const catColor = CATEGORY_COLORS[item.category] || 'var(--color-saffron)';

        // Check if overdue
        const today = new Date().toISOString().split('T')[0];
        const isOverdue = item.targetDate && item.targetDate < today;

        // Formatted Date
        const dateHtml = item.targetDate ? `
            <span class="planned-meta-pill pill-date" ${isOverdue ? 'style="background:rgba(244,63,94,0.08); color:#be123c; border-color:rgba(244,63,94,0.2); font-weight: 500;"' : ''}>
                <i class="fa-solid ${isOverdue ? 'fa-triangle-exclamation' : 'fa-calendar-days'}"></i>
                ${isOverdue ? 'Overdue: ' : ''}${formatDate(item.targetDate)}
            </span>` : `<span style="color: var(--text-muted); font-style: italic; font-size: 0.85rem;">No Date</span>`;

        // Event Badge
        const eventHtml = item.event ? `
            <span class="planned-meta-pill pill-event">
                <i class="fa-solid fa-tag"></i> ${item.event}
            </span>` : '<span style="color: var(--text-muted); font-size: 0.85rem;">—</span>';

        // Title and notes
        const titleHtml = `
            <div style="font-weight: 600; color: var(--text-primary); font-size: 0.95rem;">${item.description}</div>
            ${item.notes ? `<div style="font-size: 0.8rem; color: var(--text-muted); margin-top: 0.15rem;"><i class="fa-solid fa-note-sticky" style="margin-right: 0.25rem;"></i>${item.notes}</div>` : ''}
        `;

        tr.innerHTML = `
            <td>${titleHtml}</td>
            <td>
                <span class="planned-meta-pill pill-category" style="border-color:${catColor}30; color:${catColor}; background:${catColor}10; font-weight: 500;">
                    <i class="fa-solid fa-tag"></i> ${item.category}
                </span>
            </td>
            <td>
                ${item.payee ? `
                    <span style="font-weight: 500; display: inline-flex; align-items: center; gap: 0.3rem; color: var(--text-primary);">
                        <i class="fa-solid fa-user" style="opacity: 0.5; font-size: 0.8rem;"></i> ${item.payee}
                    </span>` : '<span style="color: var(--text-muted); font-size: 0.85rem;">—</span>'}
            </td>
            <td>${dateHtml}</td>
            <td>${eventHtml}</td>
            <td class="text-right" style="font-weight: 700; color: var(--color-saffron); font-size: 1rem;">
                ${formatCurrency(Number(item.estimatedAmount))}
            </td>
            <td class="text-center">
                <div style="display: inline-flex; gap: 0.4rem; justify-content: center;">
                    <button class="btn-convert" onclick="convertPlannedToExpense('${item.id}')" title="Mark as purchased/paid and convert to a real expense" style="padding: 0.35rem 0.75rem; font-size: 0.8rem; border-radius: 6px;">
                        <i class="fa-solid fa-circle-check"></i> Convert
                    </button>
                    <button class="btn-edit-planned" onclick="editPlannedItem('${item.id}')" title="Edit this planned item" style="padding: 0.35rem 0.55rem; font-size: 0.8rem; border-radius: 6px; background: rgba(0,0,0,0.03); border: 1px solid rgba(0,0,0,0.06);">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-delete-planned" onclick="deletePlannedItem('${item.id}')" title="Delete planned item" style="padding: 0.35rem 0.55rem; font-size: 0.8rem; border-radius: 6px; background: rgba(244,63,94,0.05); border: 1px solid rgba(244,63,94,0.15); color: #f43f5e;">
                        <i class="fa-solid fa-trash-can"></i>
                    </button>
                </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

// --- Convert Planned Item to Expense ---
window.convertPlannedToExpense = function(id) {
    const item = state.plannedItems.find(p => p.id === id);
    if (!item) return;

    // Pre-fill the expense modal with planned item data
    const modalExpense = document.getElementById('modal-add-expense');
    if (!modalExpense) return;

    // Set a flag so we know which planned item to remove after saving
    modalExpense.dataset.convertingFromPlannedId = id;

    // Pre-fill fields
    document.getElementById('expense-amount').value = item.estimatedAmount;
    document.getElementById('expense-amount-paid').value = item.estimatedAmount;
    delete document.getElementById('expense-amount-paid').dataset.userEdited;
    document.getElementById('expense-category').value = item.category;
    document.getElementById('expense-payee').value = item.payee || item.description;
    const today = new Date().toISOString().split('T')[0];
    document.getElementById('expense-date').value = today;
    document.getElementById('expense-event').value = item.event || '';
    document.getElementById('expense-notes').value = item.notes ? `[From Plan] ${item.notes}` : `[From Plan] ${item.description}`;

    // Update modal heading to indicate conversion
    const modalH2 = modalExpense.querySelector('.modal-header h2');
    if (modalH2) modalH2.innerHTML = '<i class="fa-solid fa-circle-check" style="color:var(--color-emerald); margin-right:0.5rem;"></i>Convert to Expense';

    openModal(modalExpense);
    showToast(`Confirm the actual cost for "${item.description}" then click Log Expense.`, 'info');
};

// --- Edit Planned Item ---
window.editPlannedItem = function(id) {
    const item = state.plannedItems.find(p => p.id === id);
    if (!item) return;

    const modal = document.getElementById('modal-add-planned');
    if (!modal) return;

    // Mark the modal as editing
    modal.dataset.editingId = id;

    // Pre-fill form
    document.getElementById('planned-description').value = item.description;
    document.getElementById('planned-category').value = item.category;
    document.getElementById('planned-payee').value = item.payee || '';
    document.getElementById('planned-amount').value = item.estimatedAmount;
    document.getElementById('planned-target-date').value = item.targetDate || '';
    document.getElementById('planned-event').value = item.event || '';
    document.getElementById('planned-notes').value = item.notes || '';

    // Update modal header
    const modalH2 = modal.querySelector('.modal-header h2');
    if (modalH2) modalH2.innerHTML = '<i class="fa-solid fa-pen" style="color:var(--color-saffron); margin-right:0.5rem;"></i>Edit Planned Cost';

    openModal(modal);
};

// --- Delete Planned Item ---
window.deletePlannedItem = async function(id) {
    if (!confirm('Remove this planned cost?')) return;
    const itemEl = document.querySelector(`.planned-card[data-id="${id}"], tr[data-id="${id}"]`);
    if (itemEl) {
        itemEl.classList.add('removing');
        await new Promise(r => setTimeout(r, 300));
    }
    state.plannedItems = state.plannedItems.filter(p => p.id !== id);

    if (state.supabaseConfig.mode === 'supabase' && state.userSession) {
        await deletePlannedFromSupabase(id);
    }
    saveAndSyncData('Planned item deleted');
};

// --- Status Toggles and Actions ---
window.toggleExpenseStatus = function(id) {
    const expIndex = state.expenses.findIndex(e => e.id === id);
    if (expIndex !== -1) {
        const item = state.expenses[expIndex];
        const total = Number(item.amount);
        const currentPaid = item.amountPaid !== undefined ? Number(item.amountPaid) : (item.status === 'paid' ? total : 0);
        
        // Show an interactive prompt to update the payment/deposit amount
        const input = prompt(
            `Update payment for "${item.payee || 'Expense'}" (${item.category})\n` +
            `Total Amount: ${formatCurrency(total)}\n\n` +
            `Enter amount paid so far (between 0 and ${total}):`,
            currentPaid
        );
        
        if (input === null) return; // User cancelled
        
        const val = input.trim();
        if (val === '') {
            // Toggle behavior if they entered empty string
            const nextPaid = currentPaid === total ? 0 : total;
            state.expenses[expIndex].amountPaid = nextPaid;
            state.expenses[expIndex].status = nextPaid === total ? 'paid' : 'outstanding';
        } else {
            const newPaid = parseFloat(val);
            if (isNaN(newPaid) || newPaid < 0 || newPaid > total) {
                alert(`Please enter a valid number between 0 and ${total}.`);
                return;
            }
            state.expenses[expIndex].amountPaid = newPaid;
            state.expenses[expIndex].status = newPaid === total ? 'paid' : (newPaid > 0 ? 'partial' : 'outstanding');
        }
        
        saveAndSyncData(`Updated payment for ${item.payee || 'Expense'} to ${formatCurrency(state.expenses[expIndex].amountPaid)}`);
    }
};

window.deleteTransaction = async function(id, type) {
    if (!confirm('Are you sure you want to permanently delete this transaction?')) return;
    
    if (type === 'deposit') {
        state.deposits = state.deposits.filter(d => d.id !== id);
    } else {
        state.expenses = state.expenses.filter(e => e.id !== id);
    }
    
    if (state.supabaseConfig.mode === 'supabase') {
        await deleteFromSupabase(id, type);
    }
    
    saveAndSyncData('Transaction deleted');
};

/// --- Storage & Sync Engine ---
function saveAndSyncData(actionLabel = 'Data update') {
    // 1. Always write locally for instantaneous safety
    saveLocalData();
    renderDashboard();

    // 2. Perform Supabase push if active and configuration is complete
    if (state.supabaseConfig.mode === 'supabase') {
        if (!isSupabaseConfigValid()) {
            showToast('Supabase Sync configuration is incomplete. Saved locally.', 'error');
            updateSyncStatus('warning', 'Sync configuration broken');
            return Promise.resolve(false);
        }

        updateSyncStatus('syncing', 'Syncing change...');
        return pushDataToSupabase()
            .then(success => {
                if (success) {
                    showToast(`${actionLabel} synced with Supabase!`, 'success');
                } else {
                    showToast('Failed to write to Supabase. Saved locally.', 'error');
                }
                return success;
            })
            .catch(e => {
                console.error(e);
                showToast('Supabase Sync Error. Saved locally.', 'error');
                return false;
            });
    }
    return Promise.resolve(true);
}

// --- Supabase API Client & Authentication ---
async function signIn(email, password) {
    const url = `${SUPABASE_URL}/auth/v1/token?grant_type=password`;
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
    };
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            // Handle email not confirmed specifically
            const msg = data.error_description || data.msg || data.message || '';
            const lowerMsg = msg.toLowerCase();
            if (lowerMsg.includes('email not confirmed') || lowerMsg.includes('not confirmed')) {
                showAuthMessage(
                    'Email not confirmed',
                    'Please check your inbox and click the confirmation link before signing in. Check your spam folder too.',
                    'warning'
                );
                // Show resend button
                showResendConfirmation(email);
                return false;
            }
            if (lowerMsg.includes('invalid login') || lowerMsg.includes('invalid credentials') || lowerMsg.includes('wrong password')) {
                showAuthMessage('Incorrect email or password', 'Please check your credentials and try again.', 'error');
                return false;
            }
            throw new Error(msg || 'Login failed');
        }
        
        const session = {
            email: data.user.email,
            id: data.user.id,
            accessToken: data.access_token
        };
        saveAuthSession(session);
        hideAuthMessage();
        showToast('Successfully signed in!', 'success');
        checkAuthRouting();
        
        // Check if this user has been granted access to another account
        await checkSharedAccess();
        
        // Sync and pull data immediately
        updateSyncStatus('syncing', 'Syncing remote data...');
        await pullDataFromSupabase();
        renderDashboard();
        return true;
    } catch (e) {
        console.error(e);
        showAuthMessage('Login Failed', e.message || 'Unable to connect. Please try again.', 'error');
        return false;
    }
}

async function signUp(email, password) {
    const url = `${SUPABASE_URL}/auth/v1/signup`;
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
    };
    
    try {
        const response = await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ email, password })
        });
        
        const data = await response.json();
        
        if (!response.ok) {
            const msg = data.msg || data.message || data.error_description || '';
            const lowerMsg = msg.toLowerCase();
            if (lowerMsg.includes('already registered') || lowerMsg.includes('user already registered')) {
                showAuthMessage('Account already exists', 'An account with this email already exists. Please sign in instead.', 'warning');
                const tabLogin = document.getElementById('tab-login');
                if (tabLogin) tabLogin.click();
                return false;
            }
            throw new Error(msg || 'Registration failed');
        }
        
        // Check if email confirmation is required
        // Supabase returns identities:[] and no access_token when confirmation is needed
        const needsConfirmation = !data.access_token && (!data.identities || data.identities.length === 0);
        
        if (needsConfirmation || !data.access_token) {
            // User already exists but not confirmed, OR email confirmation required
            showAuthMessage(
                '📧 Check your email!',
                `A confirmation link has been sent to ${email}. Please click the link in your email to activate your account, then come back and sign in.`,
                'info'
            );
            const tabLogin = document.getElementById('tab-login');
            if (tabLogin) tabLogin.click();
            return true;
        }
        
        // If Supabase auto-confirms (no email confirmation needed), log them in directly
        if (data.access_token && data.user) {
            const session = {
                email: data.user.email,
                id: data.user.id,
                accessToken: data.access_token
            };
            saveAuthSession(session);
            hideAuthMessage();
            showToast('Account created and signed in!', 'success');
            checkAuthRouting();
            updateSyncStatus('syncing', 'Setting up your account...');
            await pullDataFromSupabase();
            renderDashboard();
            return true;
        }
        
        showToast('Registration successful! Please sign in.', 'success');
        const tabLogin = document.getElementById('tab-login');
        if (tabLogin) tabLogin.click();
        return true;
    } catch (e) {
        console.error(e);
        showAuthMessage('Registration Failed', e.message || 'Unable to register. Please try again.', 'error');
        return false;
    }
}

async function resendConfirmationEmail(email) {
    const url = `${SUPABASE_URL}/auth/v1/resend`;
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Content-Type': 'application/json'
    };
    try {
        await fetch(url, {
            method: 'POST',
            headers,
            body: JSON.stringify({ type: 'signup', email })
        });
        showToast('Confirmation email resent! Check your inbox.', 'success');
    } catch(e) {
        showToast('Failed to resend. Please try registering again.', 'error');
    }
}

function showAuthMessage(title, body, type = 'info') {
    let msgEl = document.getElementById('auth-message-box');
    if (!msgEl) {
        msgEl = document.createElement('div');
        msgEl.id = 'auth-message-box';
        const form = document.getElementById('form-auth');
        if (form) form.insertAdjacentElement('beforebegin', msgEl);
    }
    const colors = {
        info:    { bg: 'rgba(99,102,241,0.08)',  border: 'rgba(99,102,241,0.3)',  text: '#4338ca' },
        warning: { bg: 'rgba(245,158,11,0.08)',  border: 'rgba(245,158,11,0.3)',  text: '#92400e' },
        error:   { bg: 'rgba(244,63,94,0.08)',   border: 'rgba(244,63,94,0.3)',   text: '#be123c' },
        success: { bg: 'rgba(16,185,129,0.08)',  border: 'rgba(16,185,129,0.3)',  text: '#065f46' }
    };
    const c = colors[type] || colors.info;
    msgEl.style.cssText = `
        background: ${c.bg};
        border: 1px solid ${c.border};
        border-radius: 10px;
        padding: 0.9rem 1.1rem;
        margin-bottom: 1.25rem;
        color: ${c.text};
        font-size: 0.875rem;
        line-height: 1.5;
    `;
    msgEl.innerHTML = `<strong style="display:block;margin-bottom:0.2rem;">${title}</strong>${body}`;
}

function hideAuthMessage() {
    const msgEl = document.getElementById('auth-message-box');
    if (msgEl) msgEl.remove();
    const resendEl = document.getElementById('auth-resend-btn');
    if (resendEl) resendEl.remove();
}

function showResendConfirmation(email) {
    let resendEl = document.getElementById('auth-resend-btn');
    if (!resendEl) {
        resendEl = document.createElement('button');
        resendEl.id = 'auth-resend-btn';
        resendEl.type = 'button';
        resendEl.style.cssText = `
            width: 100%;
            margin-top: 0.75rem;
            padding: 0.6rem;
            background: rgba(99,102,241,0.08);
            border: 1px solid rgba(99,102,241,0.2);
            border-radius: 8px;
            color: #4338ca;
            font-size: 0.85rem;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.2s;
        `;
        resendEl.textContent = '📨 Resend Confirmation Email';
        resendEl.onclick = () => resendConfirmationEmail(email);
        const msgEl = document.getElementById('auth-message-box');
        if (msgEl) msgEl.insertAdjacentElement('afterend', resendEl);
    }
}

async function signOut() {
    if (!state.userSession) return;
    
    const url = `${SUPABASE_URL}/auth/v1/logout`;
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`
    };
    
    try {
        await fetch(url, {
            method: 'POST',
            headers
        });
    } catch (e) {
        console.error('Logout request failed:', e);
    }
    
    clearAuthSession();
    showToast('Signed out successfully.', 'info');
    
    // Clear local data for security
    state.expenses = [];
    state.deposits = [];
    saveLocalData();
    
    checkAuthRouting();
    renderDashboard();
}

async function pullDataFromSupabase() {
    if (!state.userSession) return false;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const effectiveUserId = getEffectiveUserId();
    
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`,
        'Accept': 'application/json'
    };

    // When viewing a shared account, filter by the owner's user_id
    const userFilter = effectiveUserId ? `?user_id=eq.${effectiveUserId}` : '';

    try {
        // Fetch expenses, deposits & planned in parallel
        const [expensesRes, depositsRes, plannedRes] = await Promise.all([
            fetch(`${baseUrl}/rest/v1/expenses${userFilter}`, { method: 'GET', headers }),
            fetch(`${baseUrl}/rest/v1/deposits${userFilter}`, { method: 'GET', headers }),
            fetch(`${baseUrl}/rest/v1/planned_items${userFilter}`, { method: 'GET', headers })
        ]);

        if (!expensesRes.ok || !depositsRes.ok) {
            let errorMsg = `Expenses: ${expensesRes.status}, Deposits: ${depositsRes.status}`;
            updateSyncStatus('rose', 'Pull connection failed');
            showToast(`Connection Failed: ${errorMsg}`, 'error');
            return false;
        }

        const dbExpenses = await expensesRes.json();
        const dbDeposits = await depositsRes.json();

        // Convert db format to state format
        const expenses = dbExpenses.map(item => ({
            id: item.id,
            type: 'expense',
            amount: parseFloat(item.amount),
            amountPaid: parseFloat(item.amount_paid),
            category: item.category,
            payee: item.payee,
            date: item.date,
            status: item.status,
            notes: item.notes || '',
            event: item.event || ''
        }));

        const deposits = dbDeposits.map(item => ({
            id: item.id,
            type: 'deposit',
            amount: parseFloat(item.amount),
            source: item.source,
            date: item.date,
            event: item.event || ''
        }));

        // Pull planned items (graceful — if table doesn't exist yet, don't fail)
        let plannedItems = [];
        if (plannedRes.ok) {
            const dbPlanned = await plannedRes.json();
            plannedItems = dbPlanned.map(item => ({
                id: item.id,
                description: item.description,
                category: item.category,
                payee: item.payee || '',
                estimatedAmount: parseFloat(item.estimated_amount),
                targetDate: item.target_date || '',
                event: item.event || '',
                notes: item.notes || '',
                createdAt: item.created_at || ''
            }));
        } else {
            console.warn('planned_items table may not exist yet:', plannedRes.status);
        }

        // Fetch settings if table exists (optional, catch error so it doesn't block)
        try {
            const settingsRes = await fetch(`${baseUrl}/rest/v1/settings${userFilter}`, { method: 'GET', headers });
            if (settingsRes.ok) {
                const dbSettings = await settingsRes.json();
                const currencySetting = dbSettings.find(s => s.key === 'currencyCode');
                if (currencySetting) {
                    state.currencyCode = currencySetting.value;
                }
            }
        } catch(e) {
            console.warn('Failed to pull settings from Supabase:', e);
        }

        // Replace state with fetched data (authoritative from DB)
        state.expenses = expenses;
        state.deposits = deposits;
        state.plannedItems = plannedItems;

        saveLocalData();
        updateSyncStatus('green', state.sharedOwnerId ? 'Synced (Shared Account)' : 'Synced with Supabase');
        return true;
    } catch (e) {
        console.error('Error fetching data from Supabase:', e);
        updateSyncStatus('rose', 'Sync Connection Error');
        showToast(`Connection Error: ${e.message || e}`, 'error');
        return false;
    }
}

async function pushDataToSupabase() {
    if (!state.userSession) return false;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const effectiveUserId = getEffectiveUserId();

    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'resolution=merge-duplicates' // PostgREST upsert flag
    };

    // Prepare arrays matching database schema
    // Use effectiveUserId so shared members write to the owner's data
    const dbExpenses = state.expenses.map(item => ({
        id: item.id,
        amount: item.amount,
        amount_paid: item.amountPaid,
        category: item.category,
        payee: item.payee,
        date: item.date,
        status: item.status,
        notes: item.notes || null,
        event: item.event || null,
        user_id: effectiveUserId
    }));

    const dbDeposits = state.deposits.map(item => ({
        id: item.id,
        amount: item.amount,
        source: item.source,
        date: item.date,
        event: item.event || null,
        user_id: effectiveUserId
    }));

    const dbSettings = [
        { key: 'currencyCode', value: state.currencyCode, user_id: effectiveUserId }
    ];

    try {
        // Upsert both tables (POST is upsert when Prefer: resolution=merge-duplicates is set)
        const [expensesRes, depositsRes] = await Promise.all([
            dbExpenses.length > 0 ? fetch(`${baseUrl}/rest/v1/expenses`, {
                method: 'POST',
                headers,
                body: JSON.stringify(dbExpenses)
            }) : Promise.resolve({ ok: true }),
            dbDeposits.length > 0 ? fetch(`${baseUrl}/rest/v1/deposits`, {
                method: 'POST',
                headers,
                body: JSON.stringify(dbDeposits)
            }) : Promise.resolve({ ok: true })
        ]);

        if (!expensesRes.ok || !depositsRes.ok) {
            let errorMsg = `Expenses: ${expensesRes.status || 'N/A'}, Deposits: ${depositsRes.status || 'N/A'}`;
            console.error('Failed to upload to Supabase:', errorMsg);
            updateSyncStatus('rose', 'Push upload failed');
            showToast(`Upload Failed: ${errorMsg}`, 'error');
            return false;
        }

        // Push planned items (graceful — if table doesn't exist yet, don't fail)
        const dbPlanned = state.plannedItems.map(item => ({
            id: item.id,
            description: item.description,
            category: item.category,
            payee: item.payee || null,
            estimated_amount: item.estimatedAmount,
            target_date: item.targetDate || null,
            event: item.event || null,
            notes: item.notes || null,
            user_id: effectiveUserId
        }));

        if (dbPlanned.length > 0) {
            try {
                await fetch(`${baseUrl}/rest/v1/planned_items`, {
                    method: 'POST',
                    headers,
                    body: JSON.stringify(dbPlanned)
                });
            } catch(e) {
                console.warn('Failed to push planned items to Supabase:', e);
            }
        }

        // Try pushing settings, catch error so it doesn't block transactions
        try {
            await fetch(`${baseUrl}/rest/v1/settings`, {
                method: 'POST',
                headers,
                body: JSON.stringify(dbSettings)
            });
        } catch(e) {
            console.warn('Failed to push settings to Supabase:', e);
        }

        updateSyncStatus('green', state.sharedOwnerId ? 'Synced (Shared Account)' : 'Synced with Supabase');
        return true;
    } catch (e) {
        console.error('Network error writing to Supabase:', e);
        updateSyncStatus('rose', 'Connection Error');
        showToast(`Upload Error: ${e.message || e}`, 'error');
        return false;
    }
}

async function deleteFromSupabase(id, type) {
    if (state.supabaseConfig.mode !== 'supabase' || !state.userSession) return;

    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const effectiveUserId = getEffectiveUserId();
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`
    };

    const table = type === 'deposit' ? 'deposits' : 'expenses';
    try {
        // Filter by both id AND effective user_id to ensure correct record is deleted
        const res = await fetch(`${baseUrl}/rest/v1/${table}?id=eq.${id}&user_id=eq.${effectiveUserId}`, {
            method: 'DELETE',
            headers
        });
        if (!res.ok) {
            throw new Error(`HTTP ${res.status}`);
        }
    } catch (e) {
        console.error(`Error deleting transaction ${id} from Supabase:`, e);
    }
}

async function deletePlannedFromSupabase(id) {
    if (state.supabaseConfig.mode !== 'supabase' || !state.userSession) return;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const effectiveUserId = getEffectiveUserId();
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`
    };
    try {
        await fetch(`${baseUrl}/rest/v1/planned_items?id=eq.${id}&user_id=eq.${effectiveUserId}`, {
            method: 'DELETE',
            headers
        });
    } catch (e) {
        console.error(`Error deleting planned item ${id} from Supabase:`, e);
    }
}

// --- Shared Account Management ---

async function checkSharedAccess() {
    if (!state.userSession) return;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`,
        'Accept': 'application/json'
    };

    try {
        const email = encodeURIComponent(state.userSession.email.toLowerCase());
        const res = await fetch(
            `${baseUrl}/rest/v1/shared_access?shared_with_email=ilike.${email}&select=owner_id,owner_email`,
            { method: 'GET', headers }
        );
        if (res.ok) {
            const data = await res.json();
            if (data.length > 0) {
                const record = data[0];
                state.sharedOwnerId = record.owner_id;
                // Persist in session for page reloads
                state.userSession.sharedOwnerId = record.owner_id;
                state.userSession.sharedOwnerEmail = record.owner_email || 'Shared Account';
                saveAuthSession(state.userSession);
                showToast(`Viewing shared account: ${record.owner_email || 'Shared Account'}`, 'info');
            } else {
                // Not a shared user — clear any old shared state
                state.sharedOwnerId = null;
                if (state.userSession) {
                    delete state.userSession.sharedOwnerId;
                    delete state.userSession.sharedOwnerEmail;
                    saveAuthSession(state.userSession);
                }
            }
        }
    } catch(e) {
        console.warn('Could not check shared access:', e);
    }
    checkAuthRouting();
}

async function getSharedUsers() {
    if (!state.userSession || state.sharedOwnerId) return []; // Shared users can't manage shares
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`,
        'Accept': 'application/json'
    };
    try {
        const res = await fetch(`${baseUrl}/rest/v1/shared_access?owner_id=eq.${state.userSession.id}&select=id,shared_with_email,created_at`, { method: 'GET', headers });
        if (res.ok) return await res.json();
    } catch(e) { console.warn('Failed to fetch shared users:', e); }
    return [];
}

async function addSharedUser(email) {
    if (!state.userSession || !email || state.sharedOwnerId) return false;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
    };
    try {
        const res = await fetch(`${baseUrl}/rest/v1/shared_access`, {
            method: 'POST',
            headers,
            body: JSON.stringify({
                owner_id: state.userSession.id,
                owner_email: state.userSession.email,
                shared_with_email: email.toLowerCase().trim()
            })
        });
        if (!res.ok) {
            const errData = await res.json().catch(() => ({}));
            // Duplicate entry is OK
            if (res.status === 409 || (errData.code && errData.code === '23505')) {
                showToast('This email is already added.', 'warning');
                return false;
            }
            throw new Error(errData.message || `HTTP ${res.status}`);
        }
        return true;
    } catch(e) {
        console.error('Failed to add shared user:', e);
        showToast(`Failed to add user: ${e.message}`, 'error');
        return false;
    }
}

async function removeSharedUser(recordId) {
    if (!state.userSession || state.sharedOwnerId) return false;
    const baseUrl = SUPABASE_URL.replace(/\/+$/, '');
    const headers = {
        'apikey': SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${state.userSession.accessToken}`
    };
    try {
        const res = await fetch(`${baseUrl}/rest/v1/shared_access?id=eq.${recordId}&owner_id=eq.${state.userSession.id}`, {
            method: 'DELETE',
            headers
        });
        return res.ok;
    } catch(e) {
        console.error('Failed to remove shared user:', e);
        return false;
    }
}

async function renderSharedAccessList() {
    const container = document.getElementById('shared-users-list');
    const addSection = document.getElementById('share-access-section');
    if (!container) return;

    // Hide sharing management entirely if the current user is themselves a shared member
    if (state.sharedOwnerId) {
        if (addSection) addSection.style.display = 'none';
        return;
    }
    if (addSection) addSection.style.display = 'block';

    container.innerHTML = '<p style="color:var(--text-secondary);font-size:0.85rem;">Loading...</p>';
    const users = await getSharedUsers();
    if (users.length === 0) {
        container.innerHTML = '<p style="color:var(--text-muted);font-size:0.85rem;font-style:italic;">No one has access yet. Add your wife\'s email above.</p>';
        return;
    }
    container.innerHTML = users.map(u => `
        <div style="display:flex;align-items:center;justify-content:space-between;padding:0.6rem 0.8rem;background:rgba(99,102,241,0.06);border:1px solid rgba(99,102,241,0.15);border-radius:8px;margin-bottom:0.5rem;">
            <div style="display:flex;align-items:center;gap:0.5rem;">
                <i class="fa-solid fa-user-group" style="color:#6366f1;font-size:0.85rem;"></i>
                <span style="font-size:0.875rem;font-weight:500;color:var(--text-primary);">${u.shared_with_email}</span>
            </div>
            <button onclick="handleRemoveSharedUser('${u.id}')" style="background:rgba(244,63,94,0.08);border:1px solid rgba(244,63,94,0.2);color:#f43f5e;border-radius:6px;padding:0.3rem 0.6rem;cursor:pointer;font-size:0.8rem;" title="Remove access">
                <i class="fa-solid fa-xmark"></i> Remove
            </button>
        </div>
    `).join('');
}

window.handleRemoveSharedUser = async function(recordId) {
    if (!confirm('Remove this person\'s access to your account?')) return;
    const ok = await removeSharedUser(recordId);
    if (ok) {
        showToast('Access removed.', 'success');
        renderSharedAccessList();
    }
};

// --- Helper Utilities for Data Merging ---
function mergeTransactionLists(listA, listB) {
    const map = new Map();
    listA.forEach(item => map.set(item.id, item));
    listB.forEach(item => map.set(item.id, item));
    return Array.from(map.values());
}

function updateSyncStatus(colorClass, text) {
    const indicator = document.getElementById('sync-indicator');
    if (!indicator) return;
    
    const dot = indicator.querySelector('.pulse-dot');
    const statusTxt = indicator.querySelector('.status-text');
    
    // Reset colors
    dot.className = 'pulse-dot ' + colorClass;
    statusTxt.textContent = text;
}

// --- Event Handlers Setup ---
function setupEventListeners() {
    // Add Cash submit
    const formAddCash = document.getElementById('form-add-cash');
    formAddCash.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('cash-amount').value);
        const source = document.getElementById('cash-source').value;
        const event = document.getElementById('cash-event').value.trim();
        const date = document.getElementById('cash-date').value;
        
        const newDeposit = {
            id: 'dep-' + Date.now() + Math.floor(Math.random() * 100),
            type: 'deposit',
            amount: amount,
            source: source,
            date: date,
            event: event
        };
        
        state.deposits.push(newDeposit);
        closeAllModals();
        formAddCash.reset();
        
        saveAndSyncData(`Cash inflow added (+${formatCurrency(amount)})`);
    });

    // Log Expense submit
    const formAddExpense = document.getElementById('form-add-expense');
    formAddExpense.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('expense-amount').value);
        const category = document.getElementById('expense-category').value;
        const payee = document.getElementById('expense-payee').value;
        const date = document.getElementById('expense-date').value;
        const amountPaidInput = document.getElementById('expense-amount-paid').value;
        const amountPaid = amountPaidInput === '' ? amount : parseFloat(amountPaidInput);
        const event = document.getElementById('expense-event').value.trim();
        const notes = document.getElementById('expense-notes').value;

        // Determine status (for backward compatibility)
        const status = amountPaid === amount ? 'paid' : 'outstanding';

        const newExpense = {
            id: 'exp-' + Date.now() + Math.floor(Math.random() * 100),
            type: 'expense',
            amount: amount,
            amountPaid: amountPaid,
            category: category,
            payee: payee,
            date: date,
            status: status,
            notes: notes,
            event: event
        };

        state.expenses.push(newExpense);

        // If this expense came from a planned item conversion, remove the planned item
        const modalExpense = document.getElementById('modal-add-expense');
        const convertingId = modalExpense ? modalExpense.dataset.convertingFromPlannedId : null;
        if (convertingId) {
            state.plannedItems = state.plannedItems.filter(p => p.id !== convertingId);
            delete modalExpense.dataset.convertingFromPlannedId;
            // Reset modal title
            const h2 = modalExpense.querySelector('.modal-header h2');
            if (h2) h2.innerHTML = 'Log New Expense';
            // Also delete from Supabase if syncing
            if (state.supabaseConfig.mode === 'supabase' && state.userSession) {
                deletePlannedFromSupabase(convertingId);
            }
            showToast(`"${payee}" moved from Planned to Expenses ✅`, 'success');
        }

        closeAllModals();
        formAddExpense.reset();

        saveAndSyncData(`Logged expense to ${payee} (-${formatCurrency(amount)})`);
    });

    // Add Planned Cost form submit
    const formAddPlanned = document.getElementById('form-add-planned');
    if (formAddPlanned) {
        formAddPlanned.addEventListener('submit', (e) => {
            e.preventDefault();
            const modal = document.getElementById('modal-add-planned');
            const editingId = modal ? modal.dataset.editingId : null;

            const description = document.getElementById('planned-description').value.trim();
            const category = document.getElementById('planned-category').value;
            const payee = document.getElementById('planned-payee').value.trim();
            const estimatedAmount = parseFloat(document.getElementById('planned-amount').value);
            const targetDate = document.getElementById('planned-target-date').value;
            const event = document.getElementById('planned-event').value.trim();
            const notes = document.getElementById('planned-notes').value.trim();

            if (editingId) {
                // Edit existing
                const idx = state.plannedItems.findIndex(p => p.id === editingId);
                if (idx !== -1) {
                    state.plannedItems[idx] = {
                        ...state.plannedItems[idx],
                        description, category, payee, estimatedAmount, targetDate, event, notes
                    };
                }
                delete modal.dataset.editingId;
                // Reset modal header
                const h2 = modal.querySelector('.modal-header h2');
                if (h2) h2.innerHTML = '<i class="fa-solid fa-calendar-plus" style="color:var(--color-saffron); margin-right:0.5rem;"></i>Plan a Future Cost';
                showToast(`Planned cost updated: ${description}`, 'success');
            } else {
                // Add new
                const newPlanned = {
                    id: 'plan-' + Date.now() + Math.floor(Math.random() * 100),
                    description,
                    category,
                    payee,
                    estimatedAmount,
                    targetDate,
                    event,
                    notes,
                    createdAt: new Date().toISOString()
                };
                state.plannedItems.push(newPlanned);
                showToast(`Planned: ${description} (${formatCurrency(estimatedAmount)}) added!`, 'success');
            }

            closeAllModals();
            formAddPlanned.reset();
            saveAndSyncData('Planned cost saved');
        });
    }

    // Search and filters triggers
    document.getElementById('ledger-search').addEventListener('input', renderLedger);
    document.getElementById('filter-category').addEventListener('change', renderLedger);
    document.getElementById('filter-event').addEventListener('change', renderDashboard);
    document.getElementById('filter-status').addEventListener('change', renderLedger);

    // Auto-fill Paid field as user types Amount
    document.getElementById('expense-amount').addEventListener('input', (evt) => {
        const paidInput = document.getElementById('expense-amount-paid');
        if (!paidInput.dataset.userEdited) {
            paidInput.value = evt.target.value;
        }
    });

    document.getElementById('expense-amount-paid').addEventListener('input', (evt) => {
        evt.target.dataset.userEdited = 'true';
    });

    document.getElementById('form-add-expense').addEventListener('reset', () => {
        delete document.getElementById('expense-amount-paid').dataset.userEdited;
    });

    // Save Settings Submit
    const formSettings = document.getElementById('form-settings');
    formSettings.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        const selectedCurrency = document.getElementById('currency-select').value;
        const oldCurrency = state.currencyCode;
        state.currencyCode = selectedCurrency;
        
        const mode = document.getElementById('sync-mode').value;
        const oldMode = state.supabaseConfig.mode;
        
        const configChanged = mode !== oldMode;
        state.supabaseConfig.mode = mode;
        
        saveSupabaseConfig();
        closeAllModals();

        // 1. If currency changed, save locally and sync (await it to prevent concurrent pull overwriting it)
        if (oldCurrency !== selectedCurrency) {
            await saveAndSyncData('Currency updated');
        }

        // 2. Handle Syncing
        if (mode === 'supabase') {
            checkAuthRouting();
            if (configChanged) {
                if (state.userSession) {
                    updateSyncStatus('syncing', 'Syncing remote data...');
                    pullDataFromSupabase()
                        .then(success => {
                            if (success) {
                                showToast('Supabase Sync enabled and data pulled!', 'success');
                                saveAndSyncData('Settings sync');
                            } else {
                                showToast('Failed to connect to Supabase.', 'error');
                            }
                            renderDashboard();
                        });
                }
            } else {
                renderDashboard();
            }
        } else {
            // Switched to/remained in local mode
            if (oldCurrency === selectedCurrency) {
                saveLocalData();
                renderDashboard();
            }
            updateSyncStatus('grey', 'Local Storage Only');
            checkAuthRouting();
            if (oldMode === 'supabase') {
                showToast('Switched to Offline Local Storage.', 'info');
            }
        }
    });

    // Toggle Supabase Fields visibility in settings modal based on mode
    document.getElementById('sync-mode').addEventListener('change', (e) => {
        toggleSupabaseConfigVisibility(e.target.value);
    });

    // --- Authentication Event Listeners ---
    
    // Toggle Login/Signup tabs
    const tabLogin = document.getElementById('tab-login');
    const tabSignup = document.getElementById('tab-signup');
    const formAuth = document.getElementById('form-auth');
    const btnAuthAction = document.getElementById('btn-auth-action');
    
    let authMode = 'login'; // 'login' or 'signup'
    
    function switchAuthTab(newMode) {
        authMode = newMode;
        if (newMode === 'login') {
            tabLogin.classList.add('active');
            tabSignup.classList.remove('active');
            btnAuthAction.textContent = 'Sign In';
        } else {
            tabSignup.classList.add('active');
            tabLogin.classList.remove('active');
            btnAuthAction.textContent = 'Register';
        }
    }
    
    if (tabLogin) {
        tabLogin.addEventListener('click', () => switchAuthTab('login'));
    }
    if (tabSignup) {
        tabSignup.addEventListener('click', () => switchAuthTab('signup'));
    }
    
    // Auth Form submit
    if (formAuth) {
        formAuth.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = document.getElementById('auth-email').value.trim();
            const password = document.getElementById('auth-password').value;
            
            btnAuthAction.disabled = true;
            btnAuthAction.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i> Processing...';
            
            let success = false;
            if (authMode === 'login') {
                success = await signIn(email, password);
            } else {
                success = await signUp(email, password);
            }
            
            btnAuthAction.disabled = false;
            btnAuthAction.textContent = authMode === 'login' ? 'Sign In' : 'Register';
            
            if (success && authMode === 'login') {
                formAuth.reset();
            }
        });
    }

    // Toggle auth password visibility
    const btnToggleAuthPassword = document.getElementById('btn-toggle-auth-password');
    if (btnToggleAuthPassword) {
        btnToggleAuthPassword.addEventListener('click', () => {
            const passwordInput = document.getElementById('auth-password');
            const icon = btnToggleAuthPassword.querySelector('i');
            if (passwordInput.type === 'password') {
                passwordInput.type = 'text';
                icon.className = 'fa-solid fa-eye-slash';
            } else {
                passwordInput.type = 'password';
                icon.className = 'fa-solid fa-eye';
            }
        });
    }

    // Log Out button
    const btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
        btnLogout.addEventListener('click', () => {
            if (confirm('Are you sure you want to log out and clear local cache data?')) {
                signOut();
            }
        });
    }

    // Chart tabs / toggles
    const chartTabs = document.querySelectorAll('.chart-tab');
    chartTabs.forEach(tab => {
        tab.addEventListener('click', (e) => {
            chartTabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');
            
            const chartType = tab.getAttribute('data-chart');
            const catCanvas = document.getElementById('categoryChart');
            const trendCanvas = document.getElementById('trendChart');
            
            if (chartType === 'category') {
                catCanvas.style.display = 'block';
                trendCanvas.style.display = 'none';
            } else {
                catCanvas.style.display = 'none';
                trendCanvas.style.display = 'block';
            }
        });
    });

    // Import/Export buttons
    document.getElementById('btn-export-data').addEventListener('click', () => {
        const dataStr = JSON.stringify({
            expenses: state.expenses,
            deposits: state.deposits,
            plannedItems: state.plannedItems
        }, null, 2);
        const dataBlob = new Blob([dataStr], { type: 'application/json' });
        const url = URL.createObjectURL(dataBlob);
        
        const tempLink = document.createElement('a');
        tempLink.href = url;
        tempLink.download = `novaspend-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(tempLink);
        tempLink.click();
        document.body.removeChild(tempLink);
        URL.revokeObjectURL(url);
        showToast('JSON Backup exported!', 'success');
    });

    document.getElementById('btn-import-data-trigger').addEventListener('click', () => {
        document.getElementById('import-data-file').click();
    });

    document.getElementById('import-data-file').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = function(evt) {
            try {
                const parsed = JSON.parse(evt.target.result);
                if (Array.isArray(parsed.expenses) || Array.isArray(parsed.deposits) || Array.isArray(parsed.plannedItems)) {
                    state.expenses = mergeTransactionLists(state.expenses, parsed.expenses || []);
                    state.deposits = mergeTransactionLists(state.deposits, parsed.deposits || []);
                    state.plannedItems = mergeTransactionLists(state.plannedItems, parsed.plannedItems || []);
                    
                    saveAndSyncData('Imported JSON Backup');
                    showToast('Backup imported successfully and merged!', 'success');
                } else {
                    showToast('Invalid backup file format.', 'error');
                }
            } catch (err) {
                showToast('Failed to parse file.', 'error');
            }
        };
        reader.readAsText(file);
    });

    // Sidebar navigation smooth scrolling / active states
    const navDashboard = document.getElementById('nav-dashboard');
    const navLedger = document.getElementById('nav-ledger');
    const navAnalytics = document.getElementById('nav-analytics');

    navDashboard.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveNav(navDashboard);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    navLedger.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveNav(navLedger);
        document.querySelector('.ledger-section').scrollIntoView({ behavior: 'smooth' });
    });

    navAnalytics.addEventListener('click', (e) => {
        e.preventDefault();
        setActiveNav(navAnalytics);
        document.querySelector('.dashboard-grid').scrollIntoView({ behavior: 'smooth' });
    });

    // Planned Costs nav
    const navPlanned = document.getElementById('nav-planned');
    if (navPlanned) {
        navPlanned.addEventListener('click', (e) => {
            e.preventDefault();
            setActiveNav(navPlanned);
            const plannedSection = document.getElementById('planned-section');
            if (plannedSection) plannedSection.scrollIntoView({ behavior: 'smooth' });
        });
    }
}

function setActiveNav(element) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
}

function toggleSupabaseConfigVisibility(mode) {
    const fields = document.getElementById('supabase-config-fields');
    const testBtn = document.getElementById('btn-test-sync');
    
    if (fields) {
        fields.style.display = mode === 'supabase' ? 'block' : 'none';
    }
    if (testBtn) {
        testBtn.style.display = mode === 'supabase' ? 'inline-flex' : 'none';
    }
}

// --- Modal Utilities ---
function setupModals() {
    const triggerAddCash = document.getElementById('btn-add-cash-trigger');
    const triggerAddExpense = document.getElementById('btn-add-expense-trigger');
    const triggerSettings = document.getElementById('btn-settings-trigger');
    const triggerAddPlanned = document.getElementById('btn-add-planned-trigger');
    const triggerAddPlanned2 = document.getElementById('btn-add-planned-trigger2');

    const modalAddCash = document.getElementById('modal-add-cash');
    const modalAddExpense = document.getElementById('modal-add-expense');
    const modalSettings = document.getElementById('modal-settings');
    const modalAddPlanned = document.getElementById('modal-add-planned');

    // Click triggers
    triggerAddCash.addEventListener('click', () => openModal(modalAddCash));
    triggerAddExpense.addEventListener('click', () => openModal(modalAddExpense));
    triggerSettings.addEventListener('click', () => openModal(modalSettings));
    if (triggerAddPlanned) triggerAddPlanned.addEventListener('click', () => openModal(modalAddPlanned));
    if (triggerAddPlanned2) triggerAddPlanned2.addEventListener('click', () => openModal(modalAddPlanned));

    // Cancel buttons and close crosses
    document.querySelectorAll('.modal-overlay').forEach(overlay => {
        const closeBtn = overlay.querySelector('.btn-close-modal');
        const cancelBtn = overlay.querySelector('.btn-cancel');

        const closeFn = () => closeModal(overlay);
        
        if (closeBtn) closeBtn.addEventListener('click', closeFn);
        if (cancelBtn) cancelBtn.addEventListener('click', closeFn);
        
        // Clicking overlay background closes modal
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeFn();
        });
    });
}

function openModal(modalEl) {
    modalEl.classList.add('active');
    
    // Set default dates on open
    const today = new Date().toISOString().split('T')[0];
    const cashDate = document.getElementById('cash-date');
    const expenseDate = document.getElementById('expense-date');
    
    if (modalEl.id === 'modal-add-cash' && !cashDate.value) {
        cashDate.value = today;
    }
    if (modalEl.id === 'modal-add-expense' && !expenseDate.value) {
        expenseDate.value = today;
    }
    if (modalEl.id === 'modal-settings') {
        document.getElementById('currency-select').value = state.currencyCode || 'INR';
        // Load shared access list when settings opens
        renderSharedAccessList();
        // Wire up add shared user form
        const addShareForm = document.getElementById('form-add-shared-user');
        if (addShareForm && !addShareForm.dataset.bound) {
            addShareForm.dataset.bound = 'true';
            addShareForm.addEventListener('submit', async (ev) => {
                ev.preventDefault();
                const emailInput = document.getElementById('shared-user-email');
                const email = emailInput.value.trim();
                if (!email) return;
                const btn = addShareForm.querySelector('button[type=submit]');
                btn.disabled = true;
                btn.textContent = 'Adding...';
                const ok = await addSharedUser(email);
                btn.disabled = false;
                btn.textContent = 'Add';
                if (ok) {
                    emailInput.value = '';
                    showToast(`Access granted to ${email}`, 'success');
                    renderSharedAccessList();
                }
            });
        }
    }
}

function closeModal(modalEl) {
    modalEl.classList.remove('active');
    // Reset planned modal editing state if closed
    if (modalEl.id === 'modal-add-planned') {
        delete modalEl.dataset.editingId;
        const h2 = modalEl.querySelector('.modal-header h2');
        if (h2) h2.innerHTML = '<i class="fa-solid fa-calendar-plus" style="color:var(--color-saffron); margin-right:0.5rem;"></i>Plan a Future Cost';
    }
    // Reset expense modal conversion state if closed without saving
    if (modalEl.id === 'modal-add-expense') {
        delete modalEl.dataset.convertingFromPlannedId;
        const h2 = modalEl.querySelector('.modal-header h2');
        if (h2) h2.innerHTML = 'Log New Expense';
    }
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.remove('active');
        if (modal.id === 'modal-add-planned') {
            delete modal.dataset.editingId;
            const h2 = modal.querySelector('.modal-header h2');
            if (h2) h2.innerHTML = '<i class="fa-solid fa-calendar-plus" style="color:var(--color-saffron); margin-right:0.5rem;"></i>Plan a Future Cost';
        }
    });
}

// --- Custom Toast Notifications System ---
function showToast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    
    let iconClass = 'fa-solid fa-circle-info';
    if (type === 'success') iconClass = 'fa-solid fa-circle-check';
    if (type === 'error') iconClass = 'fa-solid fa-triangle-exclamation';
    if (type === 'warning') iconClass = 'fa-solid fa-circle-exclamation';

    toast.innerHTML = `
        <i class="${iconClass}"></i>
        <span>${message}</span>
    `;

    container.appendChild(toast);

    // Fade out and remove after 4.5 seconds
    setTimeout(() => {
        toast.classList.add('toast-fade-out');
        toast.addEventListener('animationend', () => {
            toast.remove();
        });
    }, 4500);
}
