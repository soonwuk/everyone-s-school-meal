import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI, Type } from "@google/genai";
import { LunchMenu, FoodItem, School } from './types';

// Initialize Gemini API
const ai = new GoogleGenAI({ apiKey: process.env.API_KEY || '' });
const NEIS_API_KEY = 'e155f381f5644d97b3d1e5790a42eda2';

// Helper: Fetch with CORS Proxy
const fetchWithProxy = async (url: string) => {
  const proxyUrl = `https://api.allorigins.win/get?url=${encodeURIComponent(url)}`;
  const response = await fetch(proxyUrl);
  const data = await response.json();
  return JSON.parse(data.contents);
};

const App = () => {
  const [menu, setMenu] = useState<LunchMenu | null>(null);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(""); // For granular loading status
  const [foodImages, setFoodImages] = useState<Record<string, string>>({});
  const [loadingImages, setLoadingImages] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  
  // State for file upload and date
  const [selectedDate, setSelectedDate] = useState<string>(new Date().toISOString().split('T')[0]);
  const [menuImage, setMenuImage] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State for School Search (Open API)
  const [selectedSchool, setSelectedSchool] = useState<School | null>(null);
  const [isSchoolModalOpen, setIsSchoolModalOpen] = useState(false);

  // Modal State (Detail View)
  const [selectedItemKey, setSelectedItemKey] = useState<string | null>(null);
  const [isIngredientMode, setIsIngredientMode] = useState(false);
  const [ingredientImages, setIngredientImages] = useState<Record<string, string>>({});
  const [loadingIngredient, setLoadingIngredient] = useState(false);
  const [customPrompt, setCustomPrompt] = useState("");

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onloadend = () => {
        setMenuImage(reader.result as string);
        // If uploading image, clear selected school to avoid confusion
        setSelectedSchool(null);
      };
      reader.readAsDataURL(file);
    }
  };

  const clearImage = () => {
    setMenuImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const goHome = () => {
    setMenu(null);
    setLoading(false);
    setError(null);
    setFoodImages({});
    setIngredientImages({});
    setMenuImage(null);
    if (fileInputRef.current) fileInputRef.current.value = '';
    // Optional: Keep selected school or clear it? Usually keeping it is better UX, but let's reset for "Fresh Start"
    // setSelectedSchool(null); 
  };

  // Generate Menu Logic
  const generateMenu = async () => {
    setLoading(true);
    setError(null);
    setMenu(null);
    setFoodImages({});
    setIngredientImages({});
    setLoadingImages({});
    setStatusMessage("메뉴 정보를 불러오는 중...");

    try {
      const dateObj = new Date(selectedDate);
      const formattedDate = dateObj.toLocaleDateString('ko-KR', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
        weekday: 'long'
      });
      const yyyymmdd = selectedDate.replace(/-/g, '');

      let promptContent = "";
      let shouldUseRawParsing = false;

      // Schema for structured output
      const responseSchema = {
        type: Type.OBJECT,
        properties: {
          rice: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
          soup: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
          side1: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
          side2: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
          side3: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
          dessert: { type: Type.OBJECT, properties: { name: {type: Type.STRING}, calories: {type: Type.STRING}, description: {type: Type.STRING} } },
        },
        required: ['rice', 'soup', 'side1', 'side2', 'side3', 'dessert']
      };

      // 1. NEIS Open API (Real School Data)
      if (selectedSchool && !menuImage) {
        setStatusMessage(`${selectedSchool.SCHUL_NM}의 NEIS 데이터를 조회 중...`);
        const apiUrl = `https://open.neis.go.kr/hub/mealServiceDietInfo?Type=json&KEY=${NEIS_API_KEY}&ATPT_OFCDC_SC_CODE=${selectedSchool.ATPT_OFCDC_SC_CODE}&SD_SCHUL_CODE=${selectedSchool.SD_SCHUL_CODE}&MLSV_YMD=${yyyymmdd}`;
        
        try {
          const data = await fetchWithProxy(apiUrl);
          
          if (data.mealServiceDietInfo) {
            const rawMenu = data.mealServiceDietInfo[1].row[0].DDISH_NM;
            const calInfo = data.mealServiceDietInfo[1].row[0].CAL_INFO;
            
            // Clean HTML tags and raw text
            const cleanMenu = rawMenu.replace(/<br\/>/g, "\n").replace(/\([0-9\.]+\)/g, "");
            
            promptContent = `
              다음은 한국 학교의 실제 급식 메뉴 데이터야 (NEIS API 제공):
              
              [메뉴 목록]
              ${cleanMenu}
              
              [총 칼로리 정보]
              ${calInfo}

              위 텍스트를 분석해서 밥, 국, 반찬 3가지, 디저트 1가지로 분류해서 JSON으로 정리해줘.
              반찬이 3가지보다 적으면 주요 반찬을 채워넣고, 많으면 가장 중요한 3가지를 선택해.
              디저트가 없으면 '없음' 혹은 가장 디저트스러운 반찬을 넣어줘.
              칼로리는 총 칼로리를 참고해서 각 메뉴별로 대략적으로 배분해서 추정해줘.
              설명(description)에는 음식의 맛이나 특징을 짧게 적어줘.
            `;
            shouldUseRawParsing = true;
          } else {
            throw new Error("해당 날짜에 급식 정보가 없습니다. (휴일이거나 데이터 없음)");
          }
        } catch (apiError: any) {
          console.warn("NEIS API Failed, falling back to AI", apiError);
          if (apiError.message.includes("급식 정보가 없습니다")) {
             throw apiError;
          }
        }
      }

      // 2. Image Upload Analysis
      if (menuImage && !shouldUseRawParsing) {
        const base64Data = menuImage.split(',')[1];
        setStatusMessage("이미지에서 식단을 분석 중...");
        
        const response = await ai.models.generateContent({
          model: 'gemini-3-flash-preview',
          contents: {
            parts: [
              { inlineData: { mimeType: 'image/jpeg', data: base64Data } },
              { text: `이 이미지는 학교 월간 급식 식단표야. 날짜 "${selectedDate}" (혹은 ${formattedDate})의 점심 메뉴를 찾아줘. 밥, 국, 반찬 3가지, 디저트 1가지로 분류해줘. 칼로리가 없으면 추정해줘.` }
            ]
          },
          config: { responseMimeType: 'application/json', responseSchema: responseSchema }
        });
        
        if (response.text) {
          const data = JSON.parse(response.text) as LunchMenu;
          data.date = formattedDate;
          setMenu(data);
          generateImagesForMenu(data);
          setLoading(false);
          return;
        }
      }

      // 3. AI Generation (Fallback or Default)
      if (!shouldUseRawParsing && !menuImage) {
        setStatusMessage("AI 영양사가 메뉴를 구상 중...");
        promptContent = `날짜 ${formattedDate}에 어울리는 대한민국 학교 급식 점심 메뉴를 생성해줘. 밥, 국, 반찬 3가지, 디저트 1가지. 칼로리 포함.`;
      }

      // Execute AI Call (Used for both NEIS parsing and pure Generation)
      setStatusMessage(shouldUseRawParsing ? "데이터를 정리하고 이미지를 준비 중..." : "메뉴를 생성 중...");
      const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: promptContent,
        config: { 
          tools: shouldUseRawParsing ? [] : [{ googleSearch: {} }], // Use search only for generation
          responseMimeType: 'application/json', 
          responseSchema: responseSchema 
        }
      });

      if (response.text) {
        const data = JSON.parse(response.text) as LunchMenu;
        data.date = formattedDate;
        setMenu(data);
        generateImagesForMenu(data);
      } else {
        throw new Error("메뉴 처리 실패");
      }

    } catch (err: any) {
      console.error(err);
      setError(err.message || "오류 발생");
    } finally {
      setLoading(false);
    }
  };

  const generateImagesForMenu = async (menuData: LunchMenu) => {
    const items: { key: string; item: FoodItem }[] = [
      { key: 'rice', item: menuData.rice },
      { key: 'soup', item: menuData.soup },
      { key: 'side1', item: menuData.side1 },
      { key: 'side2', item: menuData.side2 },
      { key: 'side3', item: menuData.side3 },
      { key: 'dessert', item: menuData.dessert },
    ];

    const initialLoadingState: Record<string, boolean> = {};
    items.forEach(i => initialLoadingState[i.key] = true);
    setLoadingImages(initialLoadingState);

    items.forEach(({ key, item }) => generateSingleImage(key, item.name));
  };

  const generateSingleImage = async (key: string, promptText: string) => {
    setLoadingImages(prev => ({ ...prev, [key]: true }));
    try {
      // Updated prompt to ensure the food fills the frame and avoids generating tray edges in the image
      const prompt = `Top-down close-up food photography of appetizing ${promptText}, filling the frame completely. No plates, no tray edges visible in the image. Professional food photography, realistic texture, soft lighting.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt,
      });

      let imageUrl = '';
      if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              imageUrl = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }
      }
      if (imageUrl) {
        setFoodImages(prev => ({ ...prev, [key]: imageUrl }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingImages(prev => ({ ...prev, [key]: false }));
    }
  };

  const generateIngredients = async (key: string, foodName: string) => {
    if (ingredientImages[key]) return;
    setLoadingIngredient(true);
    try {
      const prompt = `Raw fresh ingredients for making ${foodName}, laid out artistically on a wooden table. High quality photography.`;
      const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image',
        contents: prompt,
      });

      let imageUrl = '';
      if (response.candidates?.[0]?.content?.parts) {
          for (const part of response.candidates[0].content.parts) {
            if (part.inlineData) {
              imageUrl = `data:image/png;base64,${part.inlineData.data}`;
              break;
            }
          }
      }
      if (imageUrl) {
        setIngredientImages(prev => ({ ...prev, [key]: imageUrl }));
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingIngredient(false);
    }
  };

  const openModal = (key: string, item: FoodItem) => {
    setSelectedItemKey(key);
    setCustomPrompt(item.name);
    setIsIngredientMode(false);
  };

  const closeModal = () => {
    setSelectedItemKey(null);
  };

  const handleRegenerate = () => {
    if (selectedItemKey) {
      generateSingleImage(selectedItemKey, customPrompt);
      setIsIngredientMode(false);
    }
  };

  const getSelectedItem = () => {
    if (!menu || !selectedItemKey) return null;
    // @ts-ignore
    return menu[selectedItemKey] as FoodItem;
  };

  const selectedItem = getSelectedItem();

  return (
    <div className="min-h-screen py-8 px-4 flex flex-col items-center justify-center relative">
      {/* Home Button / Header Navigation */}
      <div className="absolute top-4 left-4 z-40">
        <button 
          onClick={goHome} 
          className="bg-white p-3 rounded-full shadow-md text-amber-600 hover:bg-amber-50 hover:scale-110 transition-all border border-gray-100"
          title="홈으로 돌아가기"
        >
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6"></path></svg>
        </button>
      </div>

      <header className="mb-6 text-center w-full max-w-lg">
        <h1 className="text-4xl font-bold text-gray-800 mb-2 cursor-pointer" onClick={goHome}>🍱 모두의 급식</h1>
        <p className="text-gray-600 mb-6">오늘의 학교 급식 메뉴와 칼로리 정보</p>
        
        {/* Only show input form if menu is not generated yet */}
        {!menu && (
          <div className="bg-white p-6 rounded-2xl shadow-md space-y-4 animate-fade-in-up">
            
            {/* School Selector */}
            <div className="border-b border-gray-100 pb-4">
              <label className="block text-sm font-medium text-gray-700 mb-2 text-left">학교 설정 (Open API)</label>
              {selectedSchool ? (
                <div className="flex items-center justify-between bg-amber-50 p-3 rounded-lg border border-amber-200">
                  <div className="text-left">
                    <div className="font-bold text-gray-800">{selectedSchool.SCHUL_NM}</div>
                    <div className="text-xs text-gray-500">{selectedSchool.ORG_RDNMA}</div>
                  </div>
                  <button 
                    onClick={() => setSelectedSchool(null)}
                    className="text-gray-400 hover:text-red-500 p-1"
                  >
                    변경
                  </button>
                </div>
              ) : (
                <button 
                  onClick={() => setIsSchoolModalOpen(true)}
                  className="w-full py-3 border-2 border-dashed border-gray-300 rounded-lg text-gray-500 hover:border-amber-500 hover:text-amber-600 hover:bg-amber-50 transition-all flex items-center justify-center"
                >
                  <span className="mr-2">🏫</span> 학교 검색하여 등록하기
                </button>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1 text-left">날짜 선택</label>
              <input 
                type="date" 
                value={selectedDate}
                onChange={(e) => setSelectedDate(e.target.value)}
                className="w-full p-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-amber-500 outline-none"
              />
            </div>

            {!selectedSchool && (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1 text-left">월간 식단표 이미지 (학교 미설정 시)</label>
                {!menuImage ? (
                  <div className="relative">
                    <input type="file" accept="image/*" ref={fileInputRef} onChange={handleFileChange} className="hidden" id="menu-upload" />
                    <label htmlFor="menu-upload" className="flex items-center justify-center w-full px-4 py-3 border-2 border-dashed border-gray-300 rounded-lg cursor-pointer hover:border-amber-500 hover:bg-amber-50 text-gray-500">
                      <span className="mr-2">📷</span> 식단표 사진 업로드하기
                    </label>
                  </div>
                ) : (
                  <div className="relative group">
                    <img src={menuImage} alt="Uploaded Menu" className="w-full h-32 object-cover rounded-lg border border-gray-200" />
                    <button onClick={clearImage} className="absolute top-2 right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600">
                      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
                    </button>
                  </div>
                )}
              </div>
            )}

            <button 
              onClick={generateMenu}
              disabled={loading}
              className={`w-full font-bold py-3 px-8 rounded-xl shadow-md transition-all transform flex items-center justify-center
                ${loading ? 'bg-gray-400 cursor-not-allowed text-gray-100' : 'bg-amber-500 hover:bg-amber-600 hover:scale-[1.02] text-white'}`}
            >
              {loading ? statusMessage : (
                selectedSchool ? '학교 실제 급식 불러오기' : 
                menuImage ? '식단표에서 메뉴 추출하기' : 'AI 추천 메뉴 생성하기'
              )}
            </button>
          </div>
        )}
      </header>

      {error && (
        <div className="bg-red-100 border border-red-400 text-red-700 px-4 py-3 rounded relative mb-4 w-full max-w-lg">
          {error}
        </div>
      )}

      {menu && (
        <div className="w-full max-w-4xl animate-fade-in-up">
          <div className="flex justify-between items-end mb-4 px-2">
            <div>
              <h2 className="text-2xl font-bold text-gray-800">{menu.date}</h2>
              {selectedSchool && <p className="text-sm text-gray-500">{selectedSchool.SCHUL_NM} 실제 식단</p>}
            </div>
            <div className="text-right">
              <span className="text-sm text-gray-500">총 칼로리</span>
              <div className="text-xl font-bold text-amber-600">
                {parseInt(menu.rice.calories || '0') + parseInt(menu.soup.calories || '0') + parseInt(menu.side1.calories || '0') + parseInt(menu.side2.calories || '0') + parseInt(menu.side3.calories || '0') + parseInt(menu.dessert.calories || '0')} kcal
              </div>
            </div>
          </div>

          <div className="stainless-steel rounded-[3rem] p-4 shadow-2xl border-4 border-[#d0d0d0] relative">
            <div className="flex flex-col gap-4 h-full">
              <div className="grid grid-cols-4 gap-4 h-[14.4rem] sm:h-[17.6rem]">
                <TrayCompartment item={menu.side1} image={foodImages['side1']} loading={loadingImages['side1']} type="circle" onClick={() => openModal('side1', menu.side1)} />
                <TrayCompartment item={menu.side2} image={foodImages['side2']} loading={loadingImages['side2']} type="circle" onClick={() => openModal('side2', menu.side2)} />
                <TrayCompartment item={menu.side3} image={foodImages['side3']} loading={loadingImages['side3']} type="circle" onClick={() => openModal('side3', menu.side3)} />
                 <TrayCompartment item={menu.dessert} image={foodImages['dessert']} loading={loadingImages['dessert']} type="circle" isDessert onClick={() => openModal('dessert', menu.dessert)} />
              </div>
              <div className="grid grid-cols-2 gap-4 h-[17.5rem] sm:h-[21.5rem] w-full">
                <TrayCompartment item={menu.rice} image={foodImages['rice']} loading={loadingImages['rice']} type="rect" onClick={() => openModal('rice', menu.rice)} />
                <TrayCompartment item={menu.soup} image={foodImages['soup']} loading={loadingImages['soup']} type="rect" onClick={() => openModal('soup', menu.soup)} />
              </div>
            </div>
            <div className="absolute bottom-1 right-8 text-[10px] text-gray-400 font-mono tracking-widest opacity-50 pointer-events-none">STAINLESS STEEL 18-8</div>
          </div>
        </div>
      )}

      {/* School Search Modal */}
      {isSchoolModalOpen && (
        <SchoolSearchModal 
          onClose={() => setIsSchoolModalOpen(false)} 
          onSelect={(school) => {
            setSelectedSchool(school);
            setMenuImage(null); // Clear image if school is selected
          }} 
        />
      )}

      {/* Detail Modal */}
      {selectedItemKey && selectedItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl max-w-lg w-full overflow-hidden flex flex-col max-h-[90vh]" onClick={e => e.stopPropagation()}>
            <div className="p-4 border-b border-gray-100 flex justify-between items-center">
              <div>
                <h3 className="text-xl font-bold text-gray-800">{selectedItem.name}</h3>
                <p className="text-sm text-gray-500">{selectedItem.calories} kcal</p>
              </div>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600 p-2">
                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
              </button>
            </div>
            <div className="relative bg-gray-100 aspect-square w-full">
              {isIngredientMode ? (
                loadingIngredient ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-600 mb-2"></div>
                    재료 준비 중...
                  </div>
                ) : ingredientImages[selectedItemKey] ? (
                  <img src={ingredientImages[selectedItemKey]} alt="Ingredients" className="w-full h-full object-cover" />
                ) : (
                   <div className="absolute inset-0 flex items-center justify-center text-gray-400">재료 이미지가 없습니다.</div>
                )
              ) : (
                loadingImages[selectedItemKey] ? (
                  <div className="absolute inset-0 flex flex-col items-center justify-center text-gray-500">
                    <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-amber-600 mb-2"></div>
                    조리 중...
                  </div>
                ) : foodImages[selectedItemKey] ? (
                  <img src={foodImages[selectedItemKey]} alt={selectedItem.name} className="w-full h-full object-cover" />
                ) : (
                  <div className="absolute inset-0 flex items-center justify-center text-gray-400">이미지가 없습니다.</div>
                )
              )}
            </div>
            <div className="flex border-b border-gray-100">
              <button 
                onClick={() => setIsIngredientMode(false)}
                className={`flex-1 py-3 font-medium text-sm transition-colors ${!isIngredientMode ? 'text-amber-600 border-b-2 border-amber-600 bg-amber-50' : 'text-gray-500 hover:text-gray-700'}`}
              >
                완성된 음식
              </button>
              <button 
                onClick={() => {
                  setIsIngredientMode(true);
                  if (!ingredientImages[selectedItemKey]) {
                    generateIngredients(selectedItemKey, selectedItem.name);
                  }
                }}
                className={`flex-1 py-3 font-medium text-sm transition-colors ${isIngredientMode ? 'text-amber-600 border-b-2 border-amber-600 bg-amber-50' : 'text-gray-500 hover:text-gray-700'}`}
              >
                들어간 재료 보기
              </button>
            </div>
            <div className="p-4 bg-gray-50">
              <label className="block text-xs font-semibold text-gray-500 mb-2">이미지가 다른가요? 수정 검색해보세요.</label>
              <div className="flex gap-2">
                <input 
                  type="text" 
                  value={customPrompt} 
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  className="flex-1 border border-gray-300 rounded-lg px-3 py-2 text-sm focus:ring-2 focus:ring-amber-500 outline-none"
                  placeholder="예: 더 매워보이는 떡볶이"
                />
                <button 
                  onClick={handleRegenerate}
                  disabled={loadingImages[selectedItemKey]}
                  className="bg-gray-800 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-gray-700 disabled:opacity-50 whitespace-nowrap"
                >
                  수정 검색
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

// Component for individual food slots (Reinforced Clipping)
const TrayCompartment = ({ 
  item, 
  image, 
  loading, 
  type,
  isDessert,
  onClick
}: { 
  item: FoodItem; 
  image?: string; 
  loading?: boolean; 
  type: 'circle' | 'rect';
  isDessert?: boolean;
  onClick: () => void;
}) => {
  return (
    <div className="flex flex-col h-full group cursor-pointer" onClick={onClick}>
      <div 
        className={`
          compartment-shadow bg-[#f0f0f0] overflow-hidden relative
          ${type === 'circle' ? 'rounded-3xl' : 'rounded-[2rem]'}
          flex-grow w-full h-full flex items-center justify-center transition-all duration-300
          hover:ring-4 hover:ring-amber-200/50 hover:shadow-lg
          isolate transform-gpu
        `}
      >
        {loading ? (
          <div className="flex flex-col items-center text-gray-300 animate-pulse">
            <svg className="w-8 h-8 mb-2" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z"></path></svg>
            <span className="text-xs">조리중...</span>
          </div>
        ) : image ? (
          <div className={`relative ${type === 'rect' ? 'w-[80%] h-[80%]' : 'w-full h-full'} rounded-[inherit] overflow-hidden z-0`}>
            <img 
              src={image} 
              alt={item.name} 
              className="w-full h-full object-cover mix-blend-multiply opacity-90 transition-transform duration-700 ease-in-out group-hover:scale-110" 
            />
            {/* Soft inner edge shadow to hide harsh cuts, forced z-index to stay on top */}
            <div className="absolute inset-0 shadow-[inset_0_0_15px_8px_#f0f0f0] pointer-events-none rounded-[inherit] z-10"></div>
          </div>
        ) : (
          <div className="text-gray-300 text-sm">이미지 없음</div>
        )}
        
        {/* Shine highlight */}
        <div className="absolute inset-0 rounded-[inherit] ring-1 ring-white/40 pointer-events-none z-20"></div>
      </div>
      <div className="mt-2 text-center">
        <h3 className={`font-medium text-gray-800 leading-tight ${type === 'circle' ? 'text-xs sm:text-sm' : 'text-sm sm:text-lg'} break-keep px-1 group-hover:text-amber-700`}>
          {isDessert && "🍦 "}{item.name}
        </h3>
        <p className="text-xs text-amber-600 font-mono mt-0.5">{item.calories}</p>
      </div>
    </div>
  );
};

const SchoolSearchModal = ({ onClose, onSelect }: { onClose: () => void; onSelect: (school: School) => void; }) => {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<School[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const searchSchool = async () => {
    if (!query) return;
    setLoading(true);
    setError(null);
    setResults([]);

    try {
      // Added KEY parameter
      const apiUrl = `https://open.neis.go.kr/hub/schoolInfo?Type=json&KEY=${NEIS_API_KEY}&SCHUL_NM=${encodeURIComponent(query)}`;
      const json = await fetchWithProxy(apiUrl);

      if (json.schoolInfo) {
        setResults(json.schoolInfo[1].row);
      } else {
        setError("검색 결과가 없습니다.");
      }
    } catch (e) {
      console.error(e);
      setError("학교 정보를 불러오지 못했습니다.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl max-w-md w-full overflow-hidden flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
        <div className="p-4 border-b border-gray-100 flex justify-between items-center bg-amber-500 text-white">
          <h3 className="font-bold text-lg">학교 검색</h3>
          <button onClick={onClose} className="hover:bg-amber-600 rounded-full p-1 transition-colors">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12"></path></svg>
          </button>
        </div>
        
        <div className="p-4 bg-gray-50 border-b border-gray-100">
          <div className="flex gap-2">
            <input 
              type="text" 
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && searchSchool()}
              className="flex-1 border border-gray-300 rounded-lg px-4 py-2 focus:ring-2 focus:ring-amber-500 outline-none"
              placeholder="학교명을 입력하세요 (예: 경기고)"
              autoFocus
            />
            <button 
              onClick={searchSchool}
              disabled={loading}
              className="bg-amber-500 text-white px-4 py-2 rounded-lg font-bold hover:bg-amber-600 disabled:bg-gray-400 transition-colors whitespace-nowrap"
            >
              {loading ? '검색중' : '검색'}
            </button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-2 min-h-[200px]">
          {error ? (
            <div className="flex flex-col items-center justify-center h-full text-gray-500 space-y-2">
              <span className="text-2xl">⚠️</span>
              <p>{error}</p>
            </div>
          ) : results.length > 0 ? (
            <ul className="space-y-1">
              {results.map((school, idx) => (
                <li key={idx}>
                  <button 
                    onClick={() => { onSelect(school); onClose(); }}
                    className="w-full text-left p-3 rounded-lg hover:bg-amber-50 border border-transparent hover:border-amber-200 transition-all group"
                  >
                    <div className="font-bold text-gray-800 group-hover:text-amber-700">{school.SCHUL_NM}</div>
                    <div className="text-xs text-gray-500">{school.ORG_RDNMA}</div>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-400">
              <span className="text-4xl mb-2">🏫</span>
              <p>학교 이름을 입력하고 검색해주세요.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default App;