/* ==========================================================================
   NovaSpend Application Logic
   State Management, UI Renderer, Chart Integrator, and GitHub Sync API
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

// --- Application State ---
let state = {
    expenses: [],
    deposits: [],
    githubConfig: {
        mode: 'local',
        username: '',
        repo: '',
        branch: 'main',
        filePath: 'expenses.json',
        token: ''
    }
};

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
    loadGithubConfig();
    
    // Attempt to load data from configured storage
    if (state.githubConfig.mode === 'github' && isGithubConfigValid()) {
        updateSyncStatus('syncing', 'Syncing with GitHub...');
        pullDataFromGithub()
            .then(success => {
                if (success) {
                    showToast('Data synced with GitHub repository!', 'success');
                } else {
                    // Fallback to local
                    loadLocalData();
                    showToast('Failed to pull from GitHub. Using offline data.', 'warning');
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
    saveLocalData();
}

function saveLocalData() {
    localStorage.setItem('novaspend_v2_data', JSON.stringify({
        expenses: state.expenses,
        deposits: state.deposits
    }));
}

function loadGithubConfig() {
    const localConfig = localStorage.getItem('novaspend_v2_gh_config');
    if (localConfig) {
        try {
            state.githubConfig = { ...state.githubConfig, ...JSON.parse(localConfig) };
            
            // Populate config form inputs
            document.getElementById('sync-mode').value = state.githubConfig.mode;
            document.getElementById('gh-username').value = state.githubConfig.username;
            document.getElementById('gh-repo').value = state.githubConfig.repo;
            document.getElementById('gh-branch').value = state.githubConfig.branch;
            document.getElementById('gh-path').value = state.githubConfig.filePath;
            document.getElementById('gh-token').value = state.githubConfig.token;
            
            toggleGithubConfigVisibility(state.githubConfig.mode);
        } catch (e) {
            console.error('Failed to load GitHub configuration', e);
        }
    }
}

function saveGithubConfig() {
    localStorage.setItem('novaspend_v2_gh_config', JSON.stringify({
        mode: state.githubConfig.mode,
        username: state.githubConfig.username,
        repo: state.githubConfig.repo,
        branch: state.githubConfig.branch,
        filePath: state.githubConfig.filePath,
        token: state.githubConfig.token
    }));
}

function isGithubConfigValid() {
    const cfg = state.githubConfig;
    return cfg.username && cfg.repo && cfg.branch && cfg.filePath && cfg.token;
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
}

function calculateAndRenderMetrics() {
    const activeEventFilter = document.getElementById('filter-event') ? document.getElementById('filter-event').value : 'all';
    const filteredExpenses = activeEventFilter === 'all' 
        ? state.expenses 
        : state.expenses.filter(e => e.event === activeEventFilter);
    const filteredDeposits = activeEventFilter === 'all' 
        ? state.deposits 
        : state.deposits.filter(d => d.event === activeEventFilter);

    // Total deposits (Deposits Paid / Cash In)
    const depositsTotal = filteredDeposits.reduce((acc, curr) => acc + Number(curr.amount), 0);
    
    // Total expenses (Sum of ALL expenses, both paid & outstanding)
    const expensesTotal = filteredExpenses.reduce((acc, curr) => acc + Number(curr.amount), 0);
    
    // Paid expenses
    const paidExpensesTotal = filteredExpenses
        .filter(exp => exp.status === 'paid')
        .reduce((acc, curr) => acc + Number(curr.amount), 0);
        
    // Outstanding expenses
    const outstandingTotal = filteredExpenses
        .filter(exp => exp.status === 'outstanding')
        .reduce((acc, curr) => acc + Number(curr.amount), 0);
        
    // Cash in hand = Total Deposits - Total Paid Expenses
    const cashInHand = depositsTotal - paidExpensesTotal;

    // Format utility
    const formatCurrency = (val) => {
        return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(val);
    };

    // DOM Updates
    document.getElementById('val-cash-hand').textContent = formatCurrency(cashInHand);
    document.getElementById('val-expenses-total').textContent = formatCurrency(expensesTotal);
    document.getElementById('val-deposits-total').textContent = formatCurrency(depositsTotal);
    document.getElementById('val-outstanding-total').textContent = formatCurrency(outstandingTotal);
    
    // Badge counter texts
    document.getElementById('val-expenses-count').textContent = `${filteredExpenses.length} recorded items`;
    document.getElementById('val-deposits-count').textContent = `${filteredDeposits.length} deposits`;
    
    const outstandingCount = filteredExpenses.filter(exp => exp.status === 'outstanding').length;
    document.getElementById('val-outstanding-count').textContent = `${outstandingCount} items pending`;
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
                <span class="cat-amount">£${amount.toFixed(2)} (${percentage}%)</span>
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
                                    label += new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(context.parsed);
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
            event: d.event || ''
        })),
        ...state.expenses.map(e => ({
            ...e,
            unifiedType: 'expense',
            unifiedType: e.status === 'outstanding' ? 'outstanding' : 'expense',
            event: e.event || ''
        }))
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
        if (filterStatus !== 'all' && item.status !== filterStatus) {
            return false;
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
            <tr>
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
        
        if (item.unifiedType === 'deposit') {
            amountClass = 'amount-deposit';
            amountPrefix = '+';
        } else if (item.status === 'outstanding') {
            amountClass = 'amount-outstanding';
            amountPrefix = '-';
        }
        
        // Badges
        let statusBadge = '';
        if (item.category === 'Deposit') {
            statusBadge = '<span class="badge badge-deposit"><i class="fa-solid fa-circle-down"></i> Received</span>';
        } else if (item.status === 'paid') {
            statusBadge = '<span class="badge badge-paid"><i class="fa-solid fa-circle-check"></i> Paid</span>';
        } else {
            statusBadge = '<span class="badge badge-outstanding"><i class="fa-solid fa-circle-dot"></i> Outstanding</span>';
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
                ${amountPrefix}£${Number(item.amount).toFixed(2)}
            </td>
            <td class="text-center">
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

// --- Status Toggles and Actions ---
window.toggleExpenseStatus = function(id) {
    const expIndex = state.expenses.findIndex(e => e.id === id);
    if (expIndex !== -1) {
        const currentStatus = state.expenses[expIndex].status;
        state.expenses[expIndex].status = currentStatus === 'paid' ? 'outstanding' : 'paid';
        
        saveAndSyncData('Expense status updated');
    }
};

window.deleteTransaction = function(id, type) {
    if (!confirm('Are you sure you want to permanently delete this transaction?')) return;
    
    if (type === 'deposit') {
        state.deposits = state.deposits.filter(d => d.id !== id);
    } else {
        state.expenses = state.expenses.filter(e => e.id !== id);
    }
    
    saveAndSyncData('Transaction deleted');
};

// --- Storage & Sync Engine ---
function saveAndSyncData(actionLabel = 'Data update') {
    // 1. Always write locally for instantaneous safety
    saveLocalData();
    renderDashboard();

    // 2. Perform GitHub push if active and configuration is complete
    if (state.githubConfig.mode === 'github') {
        if (!isGithubConfigValid()) {
            showToast('GitHub Sync configuration is incomplete. Saved locally.', 'error');
            updateSyncStatus('warning', 'Sync configuration broken');
            return;
        }

        updateSyncStatus('syncing', 'Syncing change...');
        pushDataToGithub(actionLabel)
            .then(success => {
                if (success) {
                    showToast(`${actionLabel} synced with GitHub!`, 'success');
                } else {
                    showToast('Failed to write to GitHub. Saved locally.', 'error');
                }
            })
            .catch(e => {
                console.error(e);
                showToast('GitHub Sync Error. Saved locally.', 'error');
            });
    }
}

// --- GitHub API Client (Database-free backend logic) ---
async function pullDataFromGithub() {
    const cfg = state.githubConfig;
    const url = `https://api.github.com/repos/${cfg.username}/${cfg.repo}/contents/${cfg.filePath}?ref=${cfg.branch}`;
    
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `token ${cfg.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Cache-Control': 'no-cache'
            }
        });

        if (response.status === 404) {
            // File doesn't exist yet, we will create it on next push
            updateSyncStatus('green', 'Connected (New File)');
            return true; 
        }

        if (!response.ok) {
            updateSyncStatus('rose', 'Pull connection failed');
            return false;
        }

        const data = await response.json();
        const contentStr = decodeBase64Utf8(data.content);
        const parsed = JSON.parse(contentStr);
        
        // Merge strategy: Smart Union by unique ID
        state.expenses = mergeTransactionLists(state.expenses, parsed.expenses || []);
        state.deposits = mergeTransactionLists(state.deposits, parsed.deposits || []);
        
        // Save merged state back to local storage
        saveLocalData();
        updateSyncStatus('green', 'Synced with GitHub');
        return true;
    } catch (e) {
        console.error('Error fetching data from GitHub:', e);
        updateSyncStatus('rose', 'Sync Connection Error');
        return false;
    }
}

async function pushDataToGithub(commitMsg = 'Dashboard updates') {
    const cfg = state.githubConfig;
    const url = `https://api.github.com/repos/${cfg.username}/${cfg.repo}/contents/${cfg.filePath}`;
    
    try {
        // Step 1: Fetch the file metadata to get the current file's SHA (required by GitHub API to update a file)
        let sha = null;
        let remoteData = { expenses: [], deposits: [] };
        
        const getFileResponse = await fetch(url + `?ref=${cfg.branch}`, {
            method: 'GET',
            headers: {
                'Authorization': `token ${cfg.token}`,
                'Accept': 'application/vnd.github.v3+json',
                'Cache-Control': 'no-cache'
            }
        });
        
        if (getFileResponse.ok) {
            const fileData = await getFileResponse.json();
            sha = fileData.sha;
            
            // Try to parse remote contents so we don't accidentally overwrite external commits
            try {
                const remoteContent = decodeBase64Utf8(fileData.content);
                remoteData = JSON.parse(remoteContent);
            } catch(e) {
                console.warn('Failed parsing remote file for merge; using local overrides.', e);
            }
        }
        
        // Step 2: Merge local edits and remote edits
        const mergedExpenses = mergeTransactionLists(remoteData.expenses || [], state.expenses);
        const mergedDeposits = mergeTransactionLists(remoteData.deposits || [], state.deposits);
        
        // Update local state to match final merged output
        state.expenses = mergedExpenses;
        state.deposits = mergedDeposits;
        saveLocalData();

        // Step 3: Package payload
        const rawJsonString = JSON.stringify({
            expenses: mergedExpenses,
            deposits: mergedDeposits
        }, null, 2);
        
        const base64Content = encodeBase64Utf8(rawJsonString);
        
        const bodyPayload = {
            message: `${commitMsg} [skip ci]`,
            content: base64Content,
            branch: cfg.branch
        };
        
        if (sha) {
            bodyPayload.sha = sha;
        }

        // Step 4: Write payload back to GitHub repository
        const putResponse = await fetch(url, {
            method: 'PUT',
            headers: {
                'Authorization': `token ${cfg.token}`,
                'Content-Type': 'application/json',
                'Accept': 'application/vnd.github.v3+json'
            },
            body: JSON.stringify(bodyPayload)
        });

        if (putResponse.ok) {
            updateSyncStatus('green', 'Synced with GitHub');
            return true;
        } else {
            console.error('Failed to upload to GitHub:', await putResponse.text());
            updateSyncStatus('rose', 'Push upload failed');
            return false;
        }
    } catch (e) {
        console.error('Network error writing to GitHub:', e);
        updateSyncStatus('rose', 'Connection Error');
        return false;
    }
}

// --- Helper Utilities for GitHub / Base64 / Merging ---
function mergeTransactionLists(listA, listB) {
    const map = new Map();
    listA.forEach(item => map.set(item.id, item));
    listB.forEach(item => map.set(item.id, item));
    return Array.from(map.values());
}

// Encode UTF-8 strings safely to Base64 (supporting Unicode characters)
function encodeBase64Utf8(str) {
    return btoa(encodeURIComponent(str).replace(/%([0-9A-F]{2})/g, function(match, p1) {
        return String.fromCharCode(parseInt(p1, 16));
    }));
}

// Decode Base64 strings safely to UTF-8
function decodeBase64Utf8(b64) {
    return decodeURIComponent(atob(b64).split('').map(function(c) {
        return '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2);
    }).join(''));
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
        
        saveAndSyncData(`Cash inflow added (+£${amount.toFixed(2)})`);
    });

    // Log Expense submit
    const formAddExpense = document.getElementById('form-add-expense');
    formAddExpense.addEventListener('submit', (e) => {
        e.preventDefault();
        const amount = parseFloat(document.getElementById('expense-amount').value);
        const category = document.getElementById('expense-category').value;
        const payee = document.getElementById('expense-payee').value;
        const date = document.getElementById('expense-date').value;
        const status = document.getElementById('expense-status').value;
        const event = document.getElementById('expense-event').value.trim();
        const notes = document.getElementById('expense-notes').value;

        const newExpense = {
            id: 'exp-' + Date.now() + Math.floor(Math.random() * 100),
            type: 'expense',
            amount: amount,
            category: category,
            payee: payee,
            date: date,
            status: status,
            notes: notes,
            event: event
        };

        state.expenses.push(newExpense);
        closeAllModals();
        formAddExpense.reset();

        saveAndSyncData(`Logged expense to ${payee} (-£${amount.toFixed(2)})`);
    });

    // Search and filters triggers
    document.getElementById('ledger-search').addEventListener('input', renderLedger);
    document.getElementById('filter-category').addEventListener('change', renderLedger);
    document.getElementById('filter-event').addEventListener('change', renderDashboard);
    document.getElementById('filter-status').addEventListener('change', renderLedger);

    // Save Settings Submit
    const formSettings = document.getElementById('form-settings');
    formSettings.addEventListener('submit', (e) => {
        e.preventDefault();
        
        const mode = document.getElementById('sync-mode').value;
        state.githubConfig.mode = mode;
        
        if (mode === 'github') {
            state.githubConfig.username = document.getElementById('gh-username').value.trim();
            state.githubConfig.repo = document.getElementById('gh-repo').value.trim();
            state.githubConfig.branch = document.getElementById('gh-branch').value.trim() || 'main';
            state.githubConfig.filePath = document.getElementById('gh-path').value.trim() || 'expenses.json';
            state.githubConfig.token = document.getElementById('gh-token').value.trim();
        }
        
        saveGithubConfig();
        closeAllModals();

        if (mode === 'github') {
            if (isGithubConfigValid()) {
                updateSyncStatus('syncing', 'Syncing config...');
                pullDataFromGithub()
                    .then(success => {
                        if (success) {
                            showToast('GitHub Sync enabled successfully!', 'success');
                        } else {
                            showToast('Failed to connect to GitHub. Review settings.', 'error');
                        }
                        renderDashboard();
                    });
            } else {
                showToast('GitHub settings are incomplete!', 'warning');
                updateSyncStatus('amber', 'Config Incomplete');
                renderDashboard();
            }
        } else {
            updateSyncStatus('grey', 'Local Storage Only');
            showToast('Switched to Offline Local Storage.', 'info');
            renderDashboard();
        }
    });

    // Toggle GitHub Fields visibility in settings modal based on mode
    document.getElementById('sync-mode').addEventListener('change', (e) => {
        toggleGithubConfigVisibility(e.target.value);
    });

    // Test GitHub Connection button
    document.getElementById('btn-test-sync').addEventListener('click', () => {
        const username = document.getElementById('gh-username').value.trim();
        const repo = document.getElementById('gh-repo').value.trim();
        const branch = document.getElementById('gh-branch').value.trim() || 'main';
        const filePath = document.getElementById('gh-path').value.trim() || 'expenses.json';
        const token = document.getElementById('gh-token').value.trim();

        if (!username || !repo || !token) {
            showToast('Please fill Username, Repo, and Access Token first.', 'warning');
            return;
        }

        // Test configuration temporarily
        const originalConfig = { ...state.githubConfig };
        state.githubConfig = { mode: 'github', username, repo, branch, filePath, token };

        showToast('Testing connection...', 'info');
        
        pullDataFromGithub()
            .then(success => {
                if (success) {
                    showToast('Connection Successful! Data pulled.', 'success');
                    renderDashboard();
                } else {
                    showToast('Connection Failed. Please check token or repository.', 'error');
                    // Restore original
                    state.githubConfig = originalConfig;
                }
            })
            .catch(err => {
                console.error(err);
                showToast('Connection error.', 'error');
                state.githubConfig = originalConfig;
            });
    });

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
            deposits: state.deposits
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
                if (Array.isArray(parsed.expenses) || Array.isArray(parsed.deposits)) {
                    state.expenses = mergeTransactionLists(state.expenses, parsed.expenses || []);
                    state.deposits = mergeTransactionLists(state.deposits, parsed.deposits || []);
                    
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
}

function setActiveNav(element) {
    document.querySelectorAll('.nav-item').forEach(item => item.classList.remove('active'));
    element.classList.add('active');
}

function toggleGithubConfigVisibility(mode) {
    const fields = document.getElementById('github-config-fields');
    const testBtn = document.getElementById('btn-test-sync');
    
    if (mode === 'github') {
        fields.style.display = 'block';
        testBtn.style.display = 'inline-flex';
    } else {
        fields.style.display = 'none';
        testBtn.style.display = 'none';
    }
}

// --- Modal Utilities ---
function setupModals() {
    const triggerAddCash = document.getElementById('btn-add-cash-trigger');
    const triggerAddExpense = document.getElementById('btn-add-expense-trigger');
    const triggerSettings = document.getElementById('btn-settings-trigger');

    const modalAddCash = document.getElementById('modal-add-cash');
    const modalAddExpense = document.getElementById('modal-add-expense');
    const modalSettings = document.getElementById('modal-settings');

    // Click triggers
    triggerAddCash.addEventListener('click', () => openModal(modalAddCash));
    triggerAddExpense.addEventListener('click', () => openModal(modalAddExpense));
    triggerSettings.addEventListener('click', () => openModal(modalSettings));

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
}

function closeModal(modalEl) {
    modalEl.classList.remove('active');
}

function closeAllModals() {
    document.querySelectorAll('.modal-overlay').forEach(modal => {
        modal.classList.remove('active');
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
