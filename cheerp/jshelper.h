#ifndef CHEERP_JSHELPER_H
#define CHEERP_JSHELPER_H
#include <type_traits>
namespace [[cheerp::genericjs]] client {
	class Object;
	class String;
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
	class _Function;
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
	template<bool Variadic, class From, class To>
	constexpr bool IsAcceptableImplV = std::is_same_v<std::remove_pointer_t<RemoveCvRefT<To>>, client::_Any> || std::is_same_v<std::remove_pointer_t<RemoveCvRefT<From>>, client::_Any> || std::is_convertible_v<From, To> || std::is_convertible_v<From, const std::remove_pointer_t<To>&> || (Variadic && std::is_convertible_v<From, const char*> && std::is_same_v<To, client::String*>);
	template<bool Variadic, class From, class To>
	struct IsAcceptable {
		constexpr static bool value = IsAcceptableImplV<Variadic, From, To>;
	};
	template<bool Variadic, class From, template<class...> class To, class... T>
	struct IsAcceptable<Variadic, From*, To<T...>*> {
		template<class... U>
		[[cheerp::genericjs]]
		constexpr static bool test(To<U...>* x) {
			return IsAcceptable<Variadic, To<U...>*, To<T...>*>::value;
		}
		[[cheerp::genericjs]]
		constexpr static bool test(void*) {
			return false;
		}
		constexpr static bool value = IsAcceptableImplV<Variadic, From*, To<T...>*> || test((From*) nullptr);
	};
	template<bool Variadic, template<class...> class Class, class... T, class... U>
	struct IsAcceptable<Variadic, Class<T...>*, Class<U...>*> {
		constexpr static bool value = (IsAcceptable<Variadic, T, U>::value && ...);
	};
	template<class From, class... To>
	constexpr bool IsAcceptableV = (IsAcceptable<false, From, To>::value || ...);
	template<class From, class... To>
	constexpr bool IsAcceptableArgsV = (IsAcceptable<true, From, To>::value || ...);
	template<class T>
	[[cheerp::genericjs]]
	T identity(T value) {
		return value;
	}
	[[cheerp::genericjs]]
	client::String* makeString(const char* str);
	template<class T>
	[[cheerp::genericjs]]
	std::conditional_t<std::is_convertible_v<T, const char*>, client::String*, T&&> clientCast(T&& value) {
		if constexpr (std::is_convertible_v<T, const char*>)
			return makeString(value);
		else
			return value;
	}
}
#endif
