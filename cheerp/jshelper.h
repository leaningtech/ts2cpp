#ifndef CHEERP_JSHELPER_H
#define CHEERP_JSHELPER_H
#include <type_traits>
namespace [[cheerp::genericjs]] client {
	class Object;
	class String;
	class [[cheerp::client_layout]] _Any {
		struct [[cheerp::client_layout]] Cast {
			template<class T>
			[[gnu::always_inline]]
			operator T() const {
				T out;
				asm("%1" : "=r"(out) : "r"(this));
				return out;
			}
		};
	public:
		template<class T>
		[[gnu::always_inline]]
		T cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		[[gnu::always_inline]]
		const Cast& cast() const {
			return *this->cast<const Cast*>();
		}
		[[gnu::always_inline]]
		explicit operator double() const {
			return this->cast<double>();
		}
		[[gnu::always_inline]]
		explicit operator int() const {
			return this->cast<double>();
		}
	};
	template<class... Variants>
	class [[cheerp::client_layout]] _Union {
	public:
		template<class T>
		[[gnu::always_inline]]
		std::enable_if_t<(std::is_same_v<T, Variants> || ...), T> cast() const {
			T out;
			asm("%1" : "=r"(out) : "r"(this));
			return out;
		}
		template<class T>
		[[gnu::always_inline]]
		operator T() const {
			return this->cast<T>();
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
	template<class T>
	constexpr bool IsCharPointerV = std::is_pointer_v<std::decay_t<T>> && std::is_same_v<std::remove_cv_t<std::remove_pointer_t<std::decay_t<T>>>, char>;
	template<bool Variadic, class From, class To>
	constexpr bool IsAcceptableImplV = std::is_same_v<std::remove_pointer_t<RemoveCvRefT<To>>, client::_Any> || std::is_same_v<std::remove_pointer_t<RemoveCvRefT<From>>, client::_Any> || std::is_convertible_v<From, To> || std::is_convertible_v<From, const std::remove_pointer_t<To>&> || (Variadic && IsCharPointerV<From> && std::is_same_v<To, client::String*>);
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
	[[cheerp::genericjs, gnu::always_inline]]
	inline client::String* makeString(const char* str);
	template<class T>
	[[cheerp::genericjs, gnu::always_inline]]
	std::conditional_t<IsCharPointerV<T>, client::String*, T&&> clientCast(T&& value) {
		if constexpr (IsCharPointerV<T>)
			return makeString(value);
		else
			return value;
	}
}
#endif
