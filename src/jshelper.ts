export const JSHELPER_SOURCE = `
#ifndef CHEERP_JSHELPER_H
#define CHEERP_JSHELPER_H
#include <type_traits>
namespace [[cheerp::genericjs]] client {
	class Object;
	class [[cheerp::client_layout]] _Any {
	public:
		template<class T>
		T cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		explicit operator double() const {
			return this->cast<double>();
		}
		explicit operator int() const {
			return this->cast<double>();
		}
	};
	template<class... Variants>
	class [[cheerp::client_layout]] _Union {
	public:
		template<class T>
		std::enable_if_t<(std::is_same_v<T, Variants> || ...), T> cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		explicit operator double() const {
			return this->cast<double>();
		}
		explicit operator int() const {
			return this->cast<double>();
		}
	};
	template<class F>
	class [[cheerp::client_layout]] _Function {
	};
	template<class T>
	class TArray;
}
namespace cheerp {
	template<class T>
	struct ArrayElementType {
		using type = client::_Any*;
	};
	template<class T>
	struct ArrayElementType<client::TArray<T>> {
		using type = T;
	};
	template<class T>
	using RemoveCvRefT = std::remove_cv_t<std::remove_reference_t<T>>;
	template<class T>
	using ArrayElementTypeT = typename ArrayElementType<RemoveCvRefT<T>>::type;
	template<class From, class... To>
	constexpr bool IsAcceptableV = ((std::is_same_v<std::remove_pointer_t<RemoveCvRefT<To>>, client::_Any> || std::is_same_v<std::remove_pointer_t<RemoveCvRefT<To>>, client::Object> || std::is_convertible_v<From, To> || std::is_convertible_v<From, const std::remove_pointer_t<To>&>) || ...);
}
#endif
`;
