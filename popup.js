// 存储联系人信息的数组
let contacts = [];

// 初始化popup页面
document.addEventListener('DOMContentLoaded', function() {
    // 从Chrome存储中加载已保存的数据
    chrome.storage.local.get(['contacts'], function(result) {
        if (result.contacts) {
            contacts = result.contacts;
            updateDisplay();
        }
    });

    // 添加开始抓取按钮的点击事件监听器
    document.getElementById('startScraping').addEventListener('click', async function() {
        try {
            document.getElementById('loadingIndicator').classList.add('active');
            const [tab] = await chrome.tabs.query({active: true, currentWindow: true});
            
            if (!tab) {
                throw new Error('无法获取当前标签页');
            }

            await chrome.scripting.executeScript({
                target: {tabId: tab.id},
                function: scrapePageData
            });
        } catch (err) {
            document.getElementById('loadingIndicator').classList.remove('active');
            alert('启动采集失败: ' + err.message);
        }
    });

    // Add event listeners for all buttons
    document.getElementById('exportCSV').addEventListener('click', exportToCSV);
    document.getElementById('exportTXT').addEventListener('click', exportToTXT);
    document.getElementById('clearAll').addEventListener('click', clearAllContacts);
});

// 更新显示的联系人信息
function updateDisplay() {
    document.getElementById('totalRecords').textContent = contacts.length;
    const contactList = document.getElementById('contactList');
    contactList.innerHTML = '';
    
    contacts.forEach((contact, index) => {
        const div = document.createElement('div');
        div.className = 'contact-item';
        div.innerHTML = `
            <div class="contact-info">
                <div><strong>公司名称:</strong> ${contact.company || '未知'}</div>
                <div><strong>联系电话:</strong> ${contact.phone || '未知'} 
                    ${contact.extraPhones > 0 ? `<span class="extra-phones">(还有 ${contact.extraPhones} 个号码)</span>` : ''}
                </div>
                ${contact.address ? `<div><strong>地址:</strong> ${contact.address}</div>` : ''}
                ${contact.email ? `<div><strong>邮箱:</strong> ${contact.email}</div>` : ''}
                ${contact.regCapital ? `<div><strong>注册资本:</strong> ${contact.regCapital}</div>` : ''}
                <div class="timestamp"><small>采集时间: ${new Date(contact.timestamp).toLocaleString('zh-CN')}</small></div>
            </div>
            <div class="contact-actions">
                <button class="button delete" onclick="deleteContact(${index})">删除</button>
            </div>
        `;
        contactList.appendChild(div);
    });
}

// 在页面中执行的抓取函数
function scrapePageData() {
    try {
        // 查找所有搜索结果项
        const searchItems = document.querySelectorAll('.index_search-single__yOhYZ');
        const scrapedData = [];

        searchItems.forEach(item => {
            try {
                // 获取公司名称
                const nameElement = item.querySelector('.index_name__qEdWi span');
                const company = nameElement ? nameElement.textContent.trim() : '';

                // 获取电话信息
                const phoneDiv = item.querySelector('.index_contact-col__7AboU');
                let phone = '';
                let extraPhones = 0;

                if (phoneDiv) {
                    // 获取主要电话号码并只保留以1开头的数字
                    const mainPhone = phoneDiv.querySelector('span:not(.index_link-count-orange__pJSFY):not(.index_label__XvMCM)');
                    if (mainPhone) {
                        // 使用正则表达式匹配以1开头的11位数字
                        const phoneMatch = mainPhone.textContent.match(/1\d{10}/);
                        phone = phoneMatch ? phoneMatch[0] : '';  // 如果匹配到则使用第一个匹配结果，否则为空
                    }

                    // 获取额外电话数量
                    const morePhones = phoneDiv.querySelector('.index_link-count-orange__pJSFY');
                    extraPhones = morePhones ? parseInt(morePhones.textContent) : 0;
                }

                // 获取额外信息
                const address = item.querySelector('.index_address__mHjQD .index_value__Pl0Nh')?.textContent.trim();
                const email = item.querySelector('.index_contact-col__7AboU a[href^="mailto:"]')?.textContent.trim();
                const regCapital = item.querySelector('.index_info-col__UVcZb .index_value__Pl0Nh[title*="万人民币"]')?.textContent.trim();

                // 只有当电话号码以1开头时才添加到数据列表
                if (phone.startsWith('1')) {
                    scrapedData.push({
                        company: company,
                        phone: phone,
                        extraPhones: extraPhones,
                        address: address || '',
                        email: email || '',
                        regCapital: regCapital || '',
                        timestamp: new Date().toISOString()
                    });
                }
            } catch (err) {
                console.error('处理元素时出错:', err);
            }
        });

        if (scrapedData.length === 0) {
            throw new Error('未找到任何有效的手机号码数据');
        }

        // 发送抓取结果
        chrome.runtime.sendMessage({
            action: 'updateContacts',
            data: scrapedData
        });

        return {
            success: true,
            count: scrapedData.length
        };

    } catch (err) {
        console.error('采集错误:', err);
        return {
            success: false,
            error: err.message
        };
    }
}

// 删除联系人记录
function deleteContact(index) {
    contacts.splice(index, 1);
    // 更新存储和显示
    chrome.storage.local.set({ contacts: contacts }, function() {
        updateDisplay();
    });
}

// 监听来自content script的消息
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    const loadingIndicator = document.getElementById('loadingIndicator');
    
    if (request.action === 'updateContacts') {
        loadingIndicator.classList.remove('active');
        
        if (!request.data || request.data.length === 0) {
            alert('未找到任何联系人数据');
            return;
        }

        const newContacts = request.data.filter(newContact => 
            !contacts.some(existing => 
                existing.phone === newContact.phone && 
                existing.company === newContact.company
            )
        );
        
        contacts = [...contacts, ...newContacts];
        
        chrome.storage.local.set({ contacts: contacts }, function() {
            updateDisplay();
            alert(`采集完成！\n新增数据: ${newContacts.length} 条\n总计数据: ${contacts.length} 条`);
        });
    }
});

// 导出数据为CSV
function exportToCSV() {
    try {
        if (!contacts || contacts.length === 0) {
            alert('没有可导出的数据');
            return;
        }

        const csvContent = [
            ['公司名称', '联系电话', '额外电话数量', '地址', '邮箱', '注册资本', '采集时间'],
            ...contacts.map(contact => [
                `"${contact.company || ''}"`,  // Add quotes to handle commas in company names
                contact.phone || '',
                contact.extraPhones || '0',
                `"${contact.address || ''}"`,   // Add quotes to handle commas in addresses
                contact.email || '',
                `"${contact.regCapital || ''}"`,
                new Date(contact.timestamp).toLocaleString('zh-CN')
            ])
        ].map(row => row.join(',')).join('\n');

        const blob = new Blob(['\ufeff' + csvContent], { 
            type: 'text/csv;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `联系人数据_${new Date().toLocaleDateString('zh-CN')}.csv`;
        document.body.appendChild(a);  // Needed for Firefox
        a.click();
        document.body.removeChild(a);  // Clean up
        URL.revokeObjectURL(url);

        alert('数据导出成功！');
    } catch (error) {
        console.error('导出错误:', error);
        alert('导出失败: ' + error.message);
    }
}

// 清空所有数据的确认
function clearAllContacts() {
    try {
        if (!contacts || contacts.length === 0) {
            alert('没有需要清除的数据');
            return;
        }

        if (confirm(`确定要清空所有数据吗？\n当前共有 ${contacts.length} 条数据\n此操作不可恢复。`)) {
            contacts = [];
            chrome.storage.local.set({ contacts: [] }, function() {
                updateDisplay();
                alert('所有数据已清空');
            });
        }
    } catch (error) {
        console.error('清空数据错误:', error);
        alert('清空数据失败: ' + error.message);
    }
}

// Add this new function to popup.js
function exportToTXT() {
    try {
        if (!contacts || contacts.length === 0) {
            alert('没有可导出的数据');
            return;
        }

        const textContent = contacts.map(contact => {
            return `公司名称: ${contact.company || '未知'}
联系电话: ${contact.phone || '未知'}${contact.extraPhones > 0 ? ` (还有${contact.extraPhones}个号码)` : ''}
${contact.address ? `地址: ${contact.address}\n` : ''}${contact.email ? `邮箱: ${contact.email}\n` : ''}${contact.regCapital ? `注册资本: ${contact.regCapital}\n` : ''}采集时间: ${new Date(contact.timestamp).toLocaleString('zh-CN')}
----------------------------------------`;
        }).join('\n\n');

        const blob = new Blob(['\ufeff' + textContent], { 
            type: 'text/plain;charset=utf-8'
        });
        const url = URL.createObjectURL(blob);
        
        const a = document.createElement('a');
        a.href = url;
        a.download = `联系人数据_${new Date().toLocaleDateString('zh-CN')}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        alert('文本数据导出成功！');
    } catch (error) {
        console.error('导出错误:', error);
        alert('导出失败: ' + error.message);
    }
}