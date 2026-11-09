import re

import os
path = os.path.join(os.path.dirname(__file__), 'src', 'components', 'Step3BorrowerDetails.tsx')
with open(path, 'r', encoding='utf-8') as f:
    content = f.read()

# The regex should remove all occurrences of {/* Other Marital Status Details */} block
# and {/* Other Country of Origin Details */} block, and then we reinsert them exactly once.

# Remove all Other Country blocks
content = re.sub(r'\s*\{\/\* Other Country of Origin Details \*\/}.*?(?=\n\s*\{\/\*|\n\s*\<div className="space-y-1\.5"\>|\n\s*\{\/\* Date of Birth & Live Age \*\/})', '', content, flags=re.DOTALL)

# Remove all Other Marital Status blocks
content = re.sub(r'\s*\{\/\* Other Marital Status Details \*\/}.*?(?=\n\s*\{\/\*|\n\s*\<div className="space-y-1\.5"\>|\n\s*\{\/\* Residential Address in Israel \*\/})', '', content, flags=re.DOTALL)


# Now re-insert them
country_block = '''

        {/* Other Country of Origin Details */}
        {formData.countryOfOrigin === 'Other' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
            <label htmlFor="other-country-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
            </label>
            <input
              id="other-country-input"
              type="text"
              required
              placeholder={t(language, 'provideDetails')}
              value={(formData as any).otherCountryOfOriginDetails || ''}
              onChange={(e) => setFormData({ ...formData, otherCountryOfOriginDetails: e.target.value } as any)}
              className={w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all }
            />
            {errors.otherCountryOfOriginDetails && <p className="text-xs text-red-600">{errors.otherCountryOfOriginDetails}</p>}
          </div>
        )}'''

marital_block = '''

        {/* Other Marital Status Details */}
        {formData.maritalStatus === 'Other' && (
          <div className="space-y-1.5 animate-in fade-in slide-in-from-top-1 duration-300">
            <label htmlFor="other-marital-status-input" className="block text-xs font-bold text-slate-700 ">
              {t(language, 'pleaseSpecify')} <span className="text-red-500">*</span>
            </label>
            <input
              id="other-marital-status-input"
              type="text"
              required
              placeholder={t(language, 'provideDetails')}
              value={formData.otherMaritalStatusDetails || ''}
              onChange={(e) => setFormData({ ...formData, otherMaritalStatusDetails: e.target.value })}
              className={w-full px-4 py-3 rounded-xl border bg-white text-slate-900 text-sm font-medium focus:outline-none focus:ring-2 transition-all }
            />
            {errors.otherMaritalStatusDetails && <p className="text-xs text-red-600">{errors.otherMaritalStatusDetails}</p>}
          </div>
        )}'''

# Insert country_block before Date of Birth
content = content.replace('{/* Date of Birth & Live Age */}', country_block.strip() + '\n\n        {/* Date of Birth & Live Age */}')

# Insert marital_block before Residential Address
content = content.replace('{/* Residential Address in Israel */}', marital_block.strip() + '\n\n        {/* Residential Address in Israel */}')

with open(path, 'w', encoding='utf-8') as f:
    f.write(content)
print("Cleaned up Step3BorrowerDetails.tsx")
