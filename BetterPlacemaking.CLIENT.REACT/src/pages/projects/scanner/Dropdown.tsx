import { useState, useEffect, useRef } from "react";

// Define strict TypeScript interfaces for our props
interface DropdownOption {
  label: string;
  value: string;
}

interface DropdownProps {
  label?: string;
  options: DropdownOption[];
  onSelect: (option: DropdownOption) => void;
  placeholder?: string;
}

export default function Dropdown({
  label,
  options,
  onSelect,
  placeholder = "Select an option",
}: DropdownProps) {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [selectedOption, setSelectedOption] = useState<DropdownOption | null>(null);
  
  // Create a DOM reference to detect clicks outside the element
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Toggle the open state
  const toggleDropdown = () => setIsOpen((prev) => !prev);

  // Handle option selection
  const handleOptionClick = (option: DropdownOption) => {
    setSelectedOption(option);
    onSelect(option);
    setIsOpen(false);
  };

  // Close the dropdown when clicking anywhere outside of it
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  return (
    <div className="w-64 space-y-1" ref={dropdownRef}>
      {label && <label className="block text-sm font-medium text-gray-700">{label}</label>}
      
      <div className="relative">
        {/* Trigger Button */}
        <button
          type="button"
          onClick={toggleDropdown}
          className="flex w-full items-center justify-between rounded-lg border border-gray-300 bg-white px-4 py-2 text-left text-sm font-medium text-gray-700 shadow-sm transition-colors hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-[#5039f6] focus:ring-offset-2"
        >
          <span>{selectedOption ? selectedOption.label : placeholder}</span>
          {/* Chevron Icon */}
          <svg
            className={`h-5 w-5 text-gray-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
            xmlns="http://w3.org"
            viewBox="0 0 20 20"
            fill="currentColor"
          >
            <path
              fillRule="evenodd"
              d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
              clipRule="evenodd"
            />
          </svg>
        </button>

        {/* Floating Menu List */}
        {isOpen && (
          <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-auto rounded-md bg-white py-1 text-sm shadow-lg ring-1 ring-black ring-opacity-5 focus:outline-none">
            {options.map((option) => (
              <li
                key={option.value}
                onClick={() => handleOptionClick(option)}
                className={`relative cursor-pointer select-none px-4 py-2 text-gray-900 transition-colors hover:bg-[#5039f6] hover:text-white ${
                  selectedOption?.value === option.value ? "bg-blue-50 font-semibold" : ""
                }`}
              >
                {option.label}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
